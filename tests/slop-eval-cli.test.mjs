import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      // 의존성을 바꾸는 명령은 막는다 — node_modules는 예제 저장소에 링크돼 있다
      assert.match(call.args[call.args.indexOf('--disallowedTools') + 1], /Bash\(npm install \*\)/)
    }
    assert.equal(calls.filter((call) => call.args.includes('--plugin-dir')).length, 1)
    assert.equal(calls[1].args[calls[1].args.indexOf('--plugin-dir') + 1], ROOT.replace(/\/$/, ''))
    assert.equal(new Set(calls.map((call) => call.args[call.args.indexOf('--append-system-prompt') + 1])).size, 1)

    const record = JSON.parse(readFileSync(join(out, 'm/without/F1-1.json'), 'utf8'))
    assert.equal(record.output, '테스트를 썼습니다')
    assert.ok(readFileSync(join(out, 'm/without/F1-1.patch'), 'utf8').includes('web/src/cart.test.ts'))
    assert.ok(record.check.slop.findings.some((finding) => finding.id === 'test/tautology'), JSON.stringify(record.check?.slop))
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
