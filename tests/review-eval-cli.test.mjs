import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './helpers/repo.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(ROOT, 'scripts/review-eval.mjs')
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })

// 예제 저장소를 흉내 낸 작은 저장소 — 결함 PR 하나(COM-007)와 결함 없는 PR 하나(CLEAN-001)
let repo
let out
let fake
before(() => {
  repo = makeRepo()
  out = mkdtempSync(join(tmpdir(), 'gimi-review-eval-'))
  repo.write({
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['app'] }),
    '.gitignore': 'node_modules/\n',
    'app/src/stock.ts': ['export const take = async (db, id, n) => {', "  await db.query('UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2', [id, n])", '}', ''].join('\n'),
    'app/src/label.ts': "export const label = '담기'\n",
  })
  repo.commit('정상 버전')
  repo.write({ 'app/src/stock.ts': ['export const take = async (db, id, n) => {', "  const { rows } = await db.query('SELECT stock FROM products WHERE id = $1', [id])", "  if (rows[0].stock >= n) await db.query('UPDATE products SET stock = $2 WHERE id = $1', [id, rows[0].stock - n])", '}', ''].join('\n') })
  const patch = repo.git('diff')
  repo.git('checkout', '--', 'app/src/stock.ts')
  repo.write({ 'app/src/label.ts': "export const label = '장바구니에 담기'\n" })
  const cleanPatch = repo.git('diff')
  repo.git('checkout', '--', 'app/src/label.ts')
  const pr = { title: 'feat: 재고 부족을 알린다', body: 'closes #41' }
  repo.write({
    'defects/COM-007/change.patch': patch,
    // 요구사항은 이슈 #41에만 있다 — 평가 도구의 가짜 gh가 두 리뷰어에게 같은 이슈를 준다
    'defects/COM-007/defect.json': JSON.stringify({ id: 'COM-007', rules: ['COM-007'], context: '도메인 규칙', layer: '백엔드', pr, issues: [{ number: 41, title: '재고 부족 알림', body: '남은 수량을 알리되 재고 확인과 차감은 한 번에 한다' }], findings: [{ level: '고쳐야 함', summary: '재고를 읽고 앱에서 비교해 저장한다', path: 'app/src/stock.ts', line: 3, evidence: [{ issue: 41 }] }] }),
    'defects/CLEAN-001/change.patch': cleanPatch,
    'defects/CLEAN-001/defect.json': JSON.stringify({ id: 'CLEAN-001', rules: [], context: '영향 범위', layer: '프론트', clean: true, pr: { title: 'chore: 담기 문구', body: '문구만 바꾼다' }, findings: [] }),
  })
  repo.commit('결함 PR')
  // 가짜 claude — 받은 인자·작업 폴더·브랜치를 기록하고, gimi(플러그인을 받은 쪽)만 정답을 찾는다
  fake = join(out, 'fake-claude.mjs')
  writeFileSync(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const args = process.argv.slice(2)
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
// 평가용 저장소의 설정과 PR이 바꾼 파일 — 설정이 PR diff에 섞이지 않는지 본다
const config = existsSync('.agents/gimi.json') ? readFileSync('.agents/gimi.json', 'utf8') : null
const changed = execFileSync('git', ['diff', '--name-only', 'main...HEAD'], { encoding: 'utf8' }).trim()
let ghBody = null
try {
  ghBody = execFileSync('gh', ['issue', 'view', '41', '--json', 'body', '--jq', '.body'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
} catch {}
appendFileSync(${JSON.stringify(join(out, 'calls.jsonl'))}, JSON.stringify({ args, cwd: process.cwd(), branch, ghBody, config, changed }) + '\\n')
const gimi = args.includes('--plugin-dir')
if (gimi) {
  mkdirSync('docs/gimi/reviews', { recursive: true })
  writeFileSync('docs/gimi/reviews/review.md', '리뷰 기록\\n')
}
const result = gimi ? 'FINDING 고쳐야 함 app/src/stock.ts:3 재고를 읽고 비교해 덮어쓴다' : '문제 없어 보입니다.\\nFINDING 없음'
const permission_denials = gimi ? [] : [{ tool_name: 'Bash', tool_input: { command: 'git diff main...HEAD | head -50' } }]
// stream-json — 리뷰어가 돌린 명령이 결과 앞에 이벤트로 나온다
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git diff main...HEAD' } }] } }))
console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'diff --git a/x b/x', is_error: false }] } }))
console.log(JSON.stringify({ type: 'result', result, total_cost_usd: 0.01, duration_ms: 5, num_turns: 3, permission_denials }))
`,
  )
  chmodSync(fake, 0o755)
})
after(() => {
  repo.cleanup()
  rmSync(out, { recursive: true, force: true })
})

describe('review-eval.mjs', () => {
  it('coverage — 모델 없이 결함마다 정답·근거가 맥락 묶음에 있는지 본다', () => {
    const result = run(['coverage', 'COM-007', '--fixture', repo.dir, '--out', join(out, 'cov')])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /COM-007 +도메인 규칙 +2\/2/)
    // 어떤 설정으로 모았는지 요약 줄에 적는다
    assert.match(result.stdout, /^맥락 수집 점검 \(설정 없음\)/)
    const items = JSON.parse(readFileSync(join(out, 'cov/coverage.json'), 'utf8'))['COM-007']
    assert.deepEqual(items.map((item) => [item.kind, item.covered, item.where]), [['location', true, '바뀐 조각'], ['issue', true, '의도']])
  })

  it('run — 리뷰어마다 같은 지시로 claude -p를 돌린다. gimi만 플러그인을 받고, 사용자 설정은 읽지 않으며, 폴더·브랜치 이름에 결함 ID가 없다', () => {
    for (const reviewer of ['gimi', 'code-review']) {
      const result = run(['run', 'COM-007', 'CLEAN-001', '--reviewer', reviewer, '--fixture', repo.dir, '--out', join(out, 'runs'), '--claude', fake])
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    const calls = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(calls.length, 4)
    // 가짜 gh가 PATH 앞에 있다 — 이슈가 있는 결함만 본문을 읽는다
    assert.deepEqual(calls.map((call) => call.ghBody), ['남은 수량을 알리되 재고 확인과 차감은 한 번에 한다', null, '남은 수량을 알리되 재고 확인과 차감은 한 번에 한다', null])
    for (const call of calls) {
      assert.equal(call.branch, 'feature/pr')
      assert.doesNotMatch(call.cwd, /COM-007|CLEAN-001|defect/)
      for (const flag of ['-p', '--output-format', '--setting-sources', '--no-session-persistence', '--append-system-prompt']) assert.ok(call.args.includes(flag), `${flag} — ${call.args.join(' ')}`)
      assert.equal(call.args[call.args.indexOf('--setting-sources') + 1], 'project')
      // 리뷰어가 돌린 명령을 남기려고 stream-json으로 받는다
      assert.equal(call.args[call.args.indexOf('--output-format') + 1], 'stream-json')
      assert.ok(call.args.includes('--verbose'))
      // Bash는 모두 허용한다(code-review는 git diff에 find·~/.claude 읽기를 이어 붙여, 명령 이름 규칙으로는 막힌다). 테스트 실행만 막는다
      assert.equal(call.args[call.args.indexOf('--allowedTools') + 1], 'Read Grep Glob Write Skill Agent Bash')
      assert.equal(call.args[call.args.indexOf('--disallowedTools') + 1], 'Bash(npm *) Bash(npx *) Bash(pnpm *) Bash(yarn *)')
    }
    const gimi = calls.filter((call) => call.args.includes('--plugin-dir'))
    assert.equal(gimi.length, 2)
    assert.equal(gimi[0].args[gimi[0].args.indexOf('--plugin-dir') + 1], ROOT.replace(/\/$/, ''))
    assert.ok(gimi.every((call) => call.args[call.args.indexOf('-p') + 1].startsWith('/gimi:gimi-review')))
    assert.ok(calls.filter((call) => !call.args.includes('--plugin-dir')).every((call) => call.args[call.args.indexOf('-p') + 1].startsWith('/code-review')))
    // 같은 지시 — 덧붙이는 시스템 프롬프트가 두 리뷰어에 같다
    const appended = new Set(calls.map((call) => call.args[call.args.indexOf('--append-system-prompt') + 1]))
    assert.equal(appended.size, 1)
    // 코드는 고치지 않되, 리뷰 절차가 남기는 리뷰 기록은 막지 않는다(리뷰 줄 측정에서 gimi가 기록을 24번 중 9번만 남겼다)
    const [instruction] = appended
    assert.match(instruction, /코드는 고치지 않고 커밋하지 않는다\. 리뷰 절차가 리뷰 기록 파일을 남기라고 하면 그대로 남긴다\./)
    assert.doesNotMatch(instruction, /코드를 고치거나 커밋하지 않는다/)
    assert.ok(readdirSync(join(out, 'runs/gimi')).includes('COM-007-1.json'))
    // 막힌 도구 호출을 남긴다 — 리뷰어가 diff를 못 봤는지 확인할 때 본다
    const baseline = JSON.parse(readFileSync(join(out, 'runs/code-review/COM-007-1.json'), 'utf8'))
    assert.deepEqual(baseline.permissionDenials, [{ tool: 'Bash', input: 'git diff main...HEAD | head -50' }])
    assert.deepEqual(baseline.commands, [{ command: 'git diff main...HEAD', status: 'ok', output: 'diff --git a/x b/x' }])
    assert.equal(baseline.costUsd, 0.01)
    // 어떤 도구 조건으로 돌았는지 남긴다 — 조건이 다른 실행을 한 표에 섞지 않으려고
    assert.deepEqual(baseline.tools, { allowed: ['Read', 'Grep', 'Glob', 'Write', 'Skill', 'Agent', 'Bash'], disallowed: ['Bash(npm *)', 'Bash(npx *)', 'Bash(pnpm *)', 'Bash(yarn *)'] })
    // 설정 조건을 남긴다 — 평가용 저장소에 설정이 없고, 규칙 목록 첫 줄은 모델 없이 rules.mjs를 돌려 얻는다
    assert.ok(calls.every((call) => call.config === null))
    for (const record of [baseline, JSON.parse(readFileSync(join(out, 'runs/gimi/COM-007-1.json'), 'utf8'))]) {
      assert.equal(record.config, null)
      assert.equal(record.rules, '규칙      stacks frontend-ts·backend (설정 없음 — 프론트·백엔드 신호를 못 찾아 둘 다) · 프리셋 없음 · 회사 규칙 없음')
    }
    // 리뷰 기록은 평가용 저장소를 지우기 전에 결과 옆에 복사한다
    assert.equal(readFileSync(join(out, 'runs/gimi/COM-007-1/docs/gimi/reviews/review.md'), 'utf8'), '리뷰 기록\n')
  })

  it('score — 결과 폴더를 채점표로 만든다', () => {
    const result = run(['score', join(out, 'runs'), '--fixture', repo.dir])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /\| gimi \| 2 \| 1\/1 \(100%\) \|/)
    assert.match(result.stdout, /\| code-review \| 2 \| 0\/1 \(0%\) \|/)
    assert.match(result.stdout, /\| CLEAN-001 \| 결함 없음 \|/)
    // 결함 PR의 diff와 견줘 지적의 위치를 나눈다 — 가짜 gimi는 결함 없는 PR(label.ts만 바꿈)에도 stock.ts를 지적한다
    assert.match(result.stdout, /\| 리뷰어 \| 정답 밖 지적 — 바뀐 조각 · 바뀐 파일 · 바뀌지 않은 파일 \|/)
    assert.match(result.stdout, /\| gimi \| 0 — 0 · 0 · 0 \| 1 — 0 · 0 · 1 \|/)
    assert.equal(existsSync(join(out, 'runs/score.md')), true)
    // 채점표 위에 설정 조건 — 두 리뷰어가 같은 조건이라 알림은 없다
    assert.ok(result.stdout.startsWith('| 리뷰어 | 실행 | 설정(.agents/gimi.json) | 규칙 목록 첫 줄 |'), result.stdout)
    assert.ok(result.stdout.includes('| gimi | 2 | 없음 | stacks frontend-ts·backend (설정 없음 — 프론트·백엔드 신호를 못 찾아 둘 다) · 프리셋 없음 · 회사 규칙 없음 |'), result.stdout)
    assert.doesNotMatch(result.stdout, /설정 조건이 다르다/)
  })

  it('run --config — 설정을 정상 버전(main)에 넣어 두 리뷰어가 같은 설정을 본다. PR diff에는 없다', () => {
    const config = join(out, 'gimi.json')
    writeFileSync(config, `${JSON.stringify({ stacks: ['backend'], presets: ['commerce'] }, null, 2)}\n`)
    const before = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').length
    for (const reviewer of ['gimi', 'code-review']) {
      const result = run(['run', 'COM-007', '--reviewer', reviewer, '--fixture', repo.dir, '--out', join(out, 'runs-config'), '--claude', fake, '--config', config])
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    const calls = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').slice(before).map((line) => JSON.parse(line))
    assert.equal(calls.length, 2)
    for (const call of calls) {
      assert.deepEqual(JSON.parse(call.config), { stacks: ['backend'], presets: ['commerce'] })
      assert.equal(call.changed, 'app/src/stock.ts')
    }
    for (const reviewer of ['gimi', 'code-review']) {
      const record = JSON.parse(readFileSync(join(out, `runs-config/${reviewer}/COM-007-1.json`), 'utf8'))
      assert.deepEqual(record.config, { stacks: ['backend'], presets: ['commerce'] })
      assert.match(record.rules, /^규칙 +stacks backend · 프리셋 commerce · 회사 규칙 없음$/)
    }
    const scored = run(['score', join(out, 'runs-config'), '--fixture', repo.dir])
    assert.equal(scored.status, 0, scored.stdout + scored.stderr)
    assert.ok(scored.stdout.includes('| gimi | 1 | `{"stacks":["backend"],"presets":["commerce"]}` | stacks backend · 프리셋 commerce · 회사 규칙 없음 |'), scored.stdout)
  })

  it('coverage --config — 같은 설정으로 맥락을 모으고 요약 줄에 적는다', () => {
    const result = run(['coverage', 'COM-007', '--fixture', repo.dir, '--config', join(out, 'gimi.json')])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /^맥락 수집 점검 \(설정 \{"stacks":\["backend"\],"presets":\["commerce"\]\}\)/)
  })

  it('--config가 JSON 객체가 아니거나 없는 파일이면 돌리지 않는다', () => {
    const broken = join(out, 'broken.json')
    writeFileSync(broken, '["backend"]\n')
    for (const file of [broken, join(out, 'missing.json')]) {
      const result = run(['run', 'COM-007', '--reviewer', 'gimi', '--fixture', repo.dir, '--out', join(out, 'runs-broken'), '--claude', fake, '--config', file])
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stderr, /--config/)
    }
    assert.equal(existsSync(join(out, 'runs-broken')), false)
  })
})
