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
  const pr = { title: 'feat: 재고 부족을 알린다', body: '요구사항 — 남은 수량을 알린다' }
  repo.write({
    'defects/COM-007/change.patch': patch,
    'defects/COM-007/defect.json': JSON.stringify({ id: 'COM-007', rules: ['COM-007'], context: '도메인 규칙', layer: '백엔드', pr, findings: [{ level: '고쳐야 함', summary: '재고를 읽고 앱에서 비교해 저장한다', path: 'app/src/stock.ts', line: 3 }] }),
    'defects/CLEAN-001/change.patch': cleanPatch,
    'defects/CLEAN-001/defect.json': JSON.stringify({ id: 'CLEAN-001', rules: [], context: '영향 범위', layer: '프론트', clean: true, pr: { title: 'chore: 담기 문구', body: '문구만 바꾼다' }, findings: [] }),
  })
  repo.commit('결함 PR')
  // 가짜 claude — 받은 인자·작업 폴더·브랜치를 기록하고, gimi(플러그인을 받은 쪽)만 정답을 찾는다
  fake = join(out, 'fake-claude.mjs')
  writeFileSync(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const args = process.argv.slice(2)
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
appendFileSync(${JSON.stringify(join(out, 'calls.jsonl'))}, JSON.stringify({ args, cwd: process.cwd(), branch }) + '\\n')
const gimi = args.includes('--plugin-dir')
if (gimi) {
  mkdirSync('docs/gimi/reviews', { recursive: true })
  writeFileSync('docs/gimi/reviews/review.md', '리뷰 기록\\n')
}
const result = gimi ? 'FINDING 고쳐야 함 app/src/stock.ts:3 재고를 읽고 비교해 덮어쓴다' : '문제 없어 보입니다.\\nFINDING 없음'
const permission_denials = gimi ? [] : [{ tool_name: 'Bash', tool_input: { command: 'git diff main...HEAD | head -50' } }]
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
    assert.match(result.stdout, /COM-007 +도메인 규칙 +1\/1/)
    assert.equal(JSON.parse(readFileSync(join(out, 'cov/coverage.json'), 'utf8'))['COM-007'][0].covered, true)
  })

  it('run — 리뷰어마다 같은 지시로 claude -p를 돌린다. gimi만 플러그인을 받고, 사용자 설정은 읽지 않으며, 폴더·브랜치 이름에 결함 ID가 없다', () => {
    for (const reviewer of ['gimi', 'code-review']) {
      const result = run(['run', 'COM-007', 'CLEAN-001', '--reviewer', reviewer, '--fixture', repo.dir, '--out', join(out, 'runs'), '--claude', fake])
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    const calls = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(calls.length, 4)
    for (const call of calls) {
      assert.equal(call.branch, 'feature/pr')
      assert.doesNotMatch(call.cwd, /COM-007|CLEAN-001|defect/)
      for (const flag of ['-p', '--output-format', '--setting-sources', '--no-session-persistence', '--append-system-prompt']) assert.ok(call.args.includes(flag), `${flag} — ${call.args.join(' ')}`)
      assert.equal(call.args[call.args.indexOf('--setting-sources') + 1], 'project')
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
    assert.ok(readdirSync(join(out, 'runs/gimi')).includes('COM-007-1.json'))
    // 막힌 도구 호출을 남긴다 — 리뷰어가 diff를 못 봤는지 확인할 때 본다
    const baseline = JSON.parse(readFileSync(join(out, 'runs/code-review/COM-007-1.json'), 'utf8'))
    assert.deepEqual(baseline.permissionDenials, [{ tool: 'Bash', input: 'git diff main...HEAD | head -50' }])
    // 어떤 도구 조건으로 돌았는지 남긴다 — 조건이 다른 실행을 한 표에 섞지 않으려고
    assert.deepEqual(baseline.tools, { allowed: ['Read', 'Grep', 'Glob', 'Write', 'Skill', 'Agent', 'Bash'], disallowed: ['Bash(npm *)', 'Bash(npx *)', 'Bash(pnpm *)', 'Bash(yarn *)'] })
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
  })
})
