import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './helpers/repo.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(ROOT, 'scripts/slop-eval.mjs')
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })

// 예제 저장소를 흉내 낸 작은 저장소와 요청 하나 — 가짜 claude가 늘 참인 단언이 든 테스트를 쓴다
let repo
let out
let fake
let requests
before(() => {
  repo = makeRepo()
  out = mkdtempSync(join(tmpdir(), 'gimi-slop-eval-'))
  repo.write({
    'package.json': JSON.stringify({ name: 'fixture', private: true }),
    '.gitignore': 'node_modules/\n',
    'web/src/cart.ts': 'export const total = (a: number, b: number) => a + b\n',
  })
  repo.commit('정상 버전')
  requests = join(out, 'requests.json')
  writeFileSync(requests, JSON.stringify({ requests: [{ id: 'F1', layer: '프론트', topic: '합계', prompt: '합계 함수에 테스트를 써 줘' }] }))
  fake = join(out, 'fake-claude.mjs')
  writeFileSync(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const args = process.argv.slice(2)
const log = (entry) => appendFileSync(${JSON.stringify(join(out, 'calls.jsonl'))}, JSON.stringify(entry) + '\\n')
if (args.includes('--tools')) {
  const stdin = readFileSync(0, 'utf8')
  log({ mode: 'judge', args, cwd: process.cwd(), stdinHasDiff: stdin.includes('diff --git'), stdinHasRequest: stdin.includes('합계 함수에 테스트를 써 줘') })
  console.log(JSON.stringify({ type: 'result', result: 'SLOP code/fire-and-forget web/src/cart.ts:1 기다리지 않는다', total_cost_usd: 0.01, duration_ms: 3, num_turns: 1 }))
} else {
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  log({ mode: 'run', args, cwd: process.cwd(), branch, config: existsSync('.agents/gimi.json') ? JSON.parse(readFileSync('.agents/gimi.json', 'utf8')) : null })
  mkdirSync('web/src', { recursive: true })
  writeFileSync('web/src/cart.test.ts', "import { expect, it } from 'vitest'\\nimport { total } from './cart'\\n\\nit('합계', () => {\\n  total(1, 2)\\n  expect(true).toBe(true)\\n})\\n")
  console.log(JSON.stringify({ type: 'result', result: '테스트를 썼습니다', total_cost_usd: 0.02, duration_ms: 5, num_turns: 2, permission_denials: [] }))
}
`,
  )
  chmodSync(fake, 0o755)
})
after(() => {
  repo.cleanup()
  rmSync(out, { recursive: true, force: true })
})

describe('slop-eval.mjs', () => {
  it('run — 정상 버전 저장소에서 요청을 실행하고 diff와 끝내기 전 검사 결과를 남긴다. gimi 있이만 플러그인을 받고 지시는 같다', () => {
    for (const arm of ['without', 'with']) {
      const result = run(['run', 'F1', '--arm', arm, '--requests', requests, '--fixture', repo.dir, '--out', join(out, 'm'), '--claude', fake])
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    const calls = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(calls.length, 2)
    for (const call of calls) {
      assert.equal(call.branch, 'main')
      assert.doesNotMatch(call.cwd, /F1|slop/)
      // 두 쪽 모두 같은 gimi 설정을 둔다(설치한 프로젝트처럼)
      assert.deepEqual(call.config, { stacks: ['frontend-ts', 'backend'], presets: ['commerce'] })
      assert.equal(call.args[call.args.indexOf('-p') + 1], '합계 함수에 테스트를 써 줘')
      assert.equal(call.args[call.args.indexOf('--setting-sources') + 1], 'project')
      // Bash는 허용 목록의 명령만 — 읽기·git 읽기·테스트와 타입 검사·gimi 스크립트. 임의 실행(node -e)·설치·DB를 내리는 명령은 목록에 없다
      const allowed = call.args[call.args.indexOf('--allowedTools') + 1]
      assert.doesNotMatch(` ${allowed} `, / Bash /)
      for (const tool of ['Edit', 'Write', 'Bash(npm test *)', 'Bash(npx vitest *)', 'Bash(git diff *)', `Bash(node ${ROOT.replace(/\/$/, '')}/skills/*)`]) assert.ok(allowed.includes(tool), `${tool} — ${allowed}`)
      assert.doesNotMatch(allowed, /Bash\(node \*\)|Bash\(npm run \*\)|Bash\(npx \*\)/)
      // 막는 규칙이 허용 규칙보다 먼저다 — 허용한 npx vitest를 덮는 넓은 이름을 막지 않는다
      const disallowed = call.args[call.args.indexOf('--disallowedTools') + 1]
      assert.match(disallowed, /Bash\(npm install \*\)/)
      assert.doesNotMatch(disallowed, /Bash\(npx \*\)/)
    }
    assert.equal(calls.filter((call) => call.args.includes('--plugin-dir')).length, 1)
    assert.equal(calls[1].args[calls[1].args.indexOf('--plugin-dir') + 1], ROOT.replace(/\/$/, ''))
    // gimi 있이는 스킬 폴더를 읽을 수 있다 — 패턴·규칙 파일을 연다(설치해 쓸 때처럼)
    assert.equal(calls[1].args[calls[1].args.indexOf('--add-dir') + 1], join(ROOT, 'skills'))
    assert.equal(calls[0].args.includes('--add-dir'), false)
    // 생성 타입을 다시 만드는 프로젝트 명령은 두 쪽 모두 쓸 수 있다
    for (const call of calls) assert.ok(call.args[call.args.indexOf('--allowedTools') + 1].includes('Bash(npm run generate:api *)'))
    assert.equal(new Set(calls.map((call) => call.args[call.args.indexOf('--append-system-prompt') + 1])).size, 1)

    const record = JSON.parse(readFileSync(join(out, 'm/without/F1-1.json'), 'utf8'))
    assert.equal(record.output, '테스트를 썼습니다')
    assert.ok(readFileSync(join(out, 'm/without/F1-1.patch'), 'utf8').includes('web/src/cart.test.ts'))
    assert.ok(record.check.slop.findings.some((finding) => finding.id === 'test/tautology'), JSON.stringify(record.check?.slop))
  })

  it('run --run N — 그 실행 하나만 다시 돌린다(다른 실행의 결과는 그대로)', () => {
    const before = readFileSync(join(out, 'm/without/F1-1.json'), 'utf8')
    const result = run(['run', 'F1', '--arm', 'without', '--run', '2', '--requests', requests, '--fixture', repo.dir, '--out', join(out, 'm'), '--claude', fake])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(readFileSync(join(out, 'm/without/F1-1.json'), 'utf8'), before)
    assert.equal(JSON.parse(readFileSync(join(out, 'm/without/F1-2.json'), 'utf8')).run, 2)
    rmSync(join(out, 'm/without/F1-2.json'))
    rmSync(join(out, 'm/without/F1-2.patch'))
    const calls = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n')
    writeFileSync(join(out, 'calls.jsonl'), `${calls.slice(0, -1).join('\n')}\n`)
  })

  it('judge — 실행마다 도구 없이 판정 모델을 부르고 답을 남긴다', () => {
    const result = run(['judge', join(out, 'm'), '--requests', requests, '--claude', fake])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const judges = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((call) => call.mode === 'judge')
    assert.equal(judges.length, 2)
    for (const call of judges) {
      assert.equal(call.args[call.args.indexOf('--tools') + 1], '')
      assert.equal(call.stdinHasDiff && call.stdinHasRequest, true)
    }
    const judged = JSON.parse(readFileSync(join(out, 'm/with/F1-1.judge.json'), 'utf8'))
    assert.deepEqual(judged.judgement.findings.map((finding) => finding.id), ['code/fire-and-forget'])
    // 이미 판정한 실행은 다시 부르지 않는다
    assert.equal(run(['judge', join(out, 'm'), '--requests', requests, '--claude', fake]).status, 0)
    assert.equal(readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').length, 4)
  })

  it('score — 줄마다 gimi 없이·있이 몇 번의 실행에서 나왔는지 표로 만든다', () => {
    const result = run(['score', join(out, 'm')])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /\| `test\/tautology` [^|]+\| 테스트 \| [^|]+\| 1\/1 \| 1\/1 \|/)
    assert.match(result.stdout, /\| `code\/fire-and-forget` [^|]+\| 코드 \| 리뷰 \| 1\/1 \| 1\/1 \|/)
    assert.equal(existsSync(join(out, 'm/score.md')), true)
  })
})

describe('slop-eval.mjs — 걸러 세기와 결과 옮기기', () => {
  it('score --rejected·--results — 걸러 낸 지적을 빼고 세고 결과 파일을 쓴다', () => {
    const rejected = join(out, 'rejected.json')
    writeFileSync(rejected, JSON.stringify([{ arm: 'with', request: 'F1', run: 1, id: 'code/fire-and-forget', path: 'web/src/cart.ts', line: 1, reason: '판정이 틀렸다' }]))
    const result = run(['score', join(out, 'm'), '--rejected', rejected, '--results', join(out, 'results.json'), '--date', '2026-10-27'])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /\| `code\/fire-and-forget` [^|]+\| 코드 \| 리뷰 \| 1\/1 \| 0\/1 \|/)
    const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'))
    assert.deepEqual([results.date, results.runs], ['2026-10-27', { without: 1, with: 1 }])
    assert.deepEqual(results.rules.find((rule) => rule.id === 'code/fire-and-forget'), { id: 'code/fire-and-forget', without: 1, with: 0 })
  })

  it('apply·buildSlopTable — 원본 규칙 파일의 근거를 바꿔 복사본에 옮기고, 두 SKILL.md의 표를 다시 쓴다', () => {
    const root = join(out, 'root')
    const rule = (id, title) => `## ${id} ${title}\n- 대상: 둘 다\n- 검사: 리뷰\n- 근거: 측정 전\n`
    const files = {
      test: `<!-- @shared test.md origin: gimi-test -->\n# 테스트\n\n${rule('test/tautology', '늘 참인 단언을 쓰지 않는다')}`,
      done: `<!-- @shared done.md origin: gimi-test -->\n# 완료\n\n${rule('done/unrun-claim', '돌리지 않고 통과했다고 하지 않는다')}`,
      code: `<!-- @shared code.md origin: gimi-review -->\n# 코드\n\n${rule('code/fire-and-forget', '비동기 작업을 기다리지 않는다')}`,
    }
    for (const skill of ['gimi-test', 'gimi-review']) {
      mkdirSync(join(root, 'skills', skill, 'shared/rules'), { recursive: true })
      writeFileSync(join(root, 'skills', skill, 'SKILL.md'), `# ${skill}\n\n<!-- slop-table:start -->\n<!-- slop-table:end -->\n`)
      for (const [area, text] of Object.entries(files)) writeFileSync(join(root, 'skills', skill, 'shared/rules', `${area}.md`), text)
    }
    const applied = run(['apply', join(out, 'results.json'), '--root', root])
    assert.equal(applied.status, 0, applied.stdout + applied.stderr)
    for (const skill of ['gimi-test', 'gimi-review']) {
      assert.match(readFileSync(join(root, 'skills', skill, 'shared/rules/code.md'), 'utf8'), /- 근거: 측정 2026-10-27 — gimi 없이 1번 중 1번 · gimi 있이 1번 중 0번/)
      assert.match(readFileSync(join(root, 'skills', skill, 'shared/rules/test.md'), 'utf8'), /- 근거: 측정 2026-10-27 — gimi 없이 1번 중 1번 · gimi 있이 1번 중 1번/)
    }
    const table = (args) => spawnSync(process.execPath, [join(ROOT, 'scripts/buildSlopTable.mjs'), ...args], { encoding: 'utf8' })
    assert.equal(table(['--check', '--root', root]).status, 1)
    assert.equal(table(['--root', root]).status, 0)
    assert.equal(table(['--check', '--root', root]).status, 0)
    const testSkill = readFileSync(join(root, 'skills/gimi-test/SKILL.md'), 'utf8')
    assert.match(testSkill, /\| `test\/tautology` 늘 참인 단언을 쓰지 않는다 \| 1번 중 1번 \| 1번 중 1번 \|/)
    assert.match(testSkill, /\| `code\/fire-and-forget` 비동기 작업을 기다리지 않는다 \| 1번 중 1번 \| 1번 중 0번 \|/)
    // gimi-review는 코드 줄만
    const reviewSkill = readFileSync(join(root, 'skills/gimi-review/SKILL.md'), 'utf8')
    assert.match(reviewSkill, /code\/fire-and-forget/)
    assert.doesNotMatch(reviewSkill, /test\/tautology/)
  })
})
