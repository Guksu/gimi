import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './helpers/repo.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(ROOT, 'scripts/slop-eval.mjs')
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })

// 예제 저장소를 흉내 낸 작은 저장소, 구현 실행의 원본 결과(gimi 없이·있이 F1 1번째 — 늘 참인 단언이 든 테스트를 썼다), 판정만 하는 가짜 claude
let repo
let out
let fake
before(() => {
  repo = makeRepo()
  out = mkdtempSync(join(tmpdir(), 'gimi-slop-eval-'))
  repo.write({
    'package.json': JSON.stringify({ name: 'fixture', private: true }),
    'web/src/cart.ts': 'export const total = (a: number, b: number) => a + b\n',
  })
  repo.commit('정상 버전')
  const patch = "diff --git a/web/src/cart.test.ts b/web/src/cart.test.ts\n+it('합계', () => {\n+  expect(true).toBe(true)\n+})\n"
  for (const arm of ['without', 'with']) {
    mkdirSync(join(out, 'm', arm), { recursive: true })
    const record = { arm, request: 'F1', run: 1, prompt: '합계 함수에 테스트를 써 줘', output: '테스트를 썼습니다', commands: [{ command: 'npx vitest run', status: 'ok', output: 'Tests 1 passed' }], check: { runs: [], slop: { findings: [{ id: 'test/tautology', path: 'web/src/cart.test.ts', line: 2 }] } } }
    writeFileSync(join(out, 'm', arm, 'F1-1.json'), JSON.stringify(record))
    writeFileSync(join(out, 'm', arm, 'F1-1.patch'), patch)
  }
  fake = join(out, 'fake-claude.mjs')
  writeFileSync(
    fake,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const log = (entry) => appendFileSync(${JSON.stringify(join(out, 'calls.jsonl'))}, JSON.stringify(entry) + '\\n')
const stdin = readFileSync(0, 'utf8')
if (stdin.includes('## review/filler')) {
  log({ mode: 'judge-review', args, stdin })
  console.log(JSON.stringify({ type: 'result', result: 'SLOP review/filler 보고 칭찬으로 시작한다', total_cost_usd: 0.01, duration_ms: 3, num_turns: 1 }))
} else {
  log({ mode: 'judge', args, stdinHasDiff: stdin.includes('diff --git'), stdinHasRequest: stdin.includes('합계 함수에 테스트를 써 줘'), stdinHasCommand: stdin.includes('- 성공 \`npx vitest run\`'), stdinRules: [...stdin.matchAll(/^## (\\S+)/gm)].map((match) => match[1]) })
  console.log(JSON.stringify({ type: 'result', result: 'SLOP code/fire-and-forget web/src/cart.ts:1 기다리지 않는다', total_cost_usd: 0.01, duration_ms: 3, num_turns: 1 }))
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
  it('judge — 실행마다 도구 없이 판정 모델을 부르고 답을 남긴다', () => {
    const result = run(['judge', join(out, 'm'), '--claude', fake])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const judges = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((call) => call.mode === 'judge')
    assert.equal(judges.length, 2)
    for (const call of judges) {
      assert.equal(call.args[call.args.indexOf('--tools') + 1], '')
      assert.equal(call.stdinHasDiff && call.stdinHasRequest && call.stdinHasCommand, true)
      // 구현 실행은 테스트·코드 줄을 판정한다(리뷰 줄은 --reviews)
      assert.ok(call.stdinRules.includes('code/fire-and-forget') && call.stdinRules.some((id) => id.startsWith('test/')))
      assert.ok(!call.stdinRules.some((id) => /^(?:done|review)\//.test(id)), call.stdinRules.join(' '))
    }
    const judged = JSON.parse(readFileSync(join(out, 'm/with/F1-1.judge.json'), 'utf8'))
    assert.deepEqual(judged.judgement.findings.map((finding) => finding.id), ['code/fire-and-forget'])
    // 이미 판정한 실행은 다시 부르지 않는다
    assert.equal(run(['judge', join(out, 'm'), '--claude', fake]).status, 0)
    assert.equal(readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').length, 2)
  })

  it('judge --areas — 고른 영역의 줄만 판정한다', () => {
    const dir = join(out, 'm-test')
    cpSync(join(out, 'm'), dir, { recursive: true })
    for (const arm of ['without', 'with']) for (const name of readdirSync(join(dir, arm)).filter((file) => file.endsWith('.judge.json'))) rmSync(join(dir, arm, name))
    const result = run(['judge', dir, '--areas', 'test', '--claude', fake])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const last = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).slice(-2)
    for (const call of last) {
      assert.equal(call.mode, 'judge')
      assert.ok(call.stdinRules.length > 0 && call.stdinRules.every((id) => id.startsWith('test/')), call.stdinRules.join(' '))
    }
    // 가짜 판정은 코드 줄을 답한다 — 맡기지 않은 줄이라 세지 않는다
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'with/F1-1.judge.json'), 'utf8')).judgement.unknown, ['code/fire-and-forget'])
    assert.match(run(['judge', dir, '--areas', 'nope', '--claude', fake]).stderr, /--areas/)
    // 완료 보고 줄은 지웠다(설계 결정 52)
    assert.match(run(['judge', dir, '--areas', 'done', '--claude', fake]).stderr, /--areas/)
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

  it('score --areas — 고른 영역의 줄만 세고, 결과 파일에 영역을 남긴다', () => {
    const result = run(['score', join(out, 'm-test'), '--areas', 'test', '--results', join(out, 'results-test.json'), '--date', '2026-10-28'])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.doesNotMatch(result.stdout, /code\//)
    const results = JSON.parse(readFileSync(join(out, 'results-test.json'), 'utf8'))
    assert.deepEqual(results.areas, ['test'])
    assert.ok(results.rules.length > 0 && results.rules.every((rule) => rule.id.startsWith('test/')))
  })

  it('apply·buildSlopTable — 규칙 파일의 근거를 바꾸고, gimi-review SKILL.md의 표를 다시 쓴다', () => {
    const root = join(out, 'root')
    const rule = (id, title) => `## ${id} ${title}\n- 대상: 둘 다\n- 검사: 리뷰\n- 근거: 측정 전\n`
    const files = {
      test: `# 테스트\n\n${rule('test/tautology', '늘 참인 단언을 쓰지 않는다')}`,
      code: `# 코드\n\n${rule('code/fire-and-forget', '비동기 작업을 기다리지 않는다')}`,
      review: `# 리뷰\n\n${rule('review/filler', '칭찬과 요약을 쓰지 않는다')}`,
    }
    mkdirSync(join(root, 'skills/gimi-review/shared/rules'), { recursive: true })
    writeFileSync(join(root, 'skills/gimi-review/SKILL.md'), '# gimi-review\n\n<!-- slop-table:start -->\n<!-- slop-table:end -->\n')
    for (const [area, text] of Object.entries(files)) writeFileSync(join(root, 'skills/gimi-review/shared/rules', `${area}.md`), text)
    const applied = run(['apply', join(out, 'results.json'), '--root', root])
    assert.equal(applied.status, 0, applied.stdout + applied.stderr)
    const rules = (area) => readFileSync(join(root, 'skills/gimi-review/shared/rules', `${area}.md`), 'utf8')
    assert.match(rules('code'), /- 근거: 측정 2026-10-27 — gimi 없이 1번 중 1번 · gimi 있이 1번 중 0번/)
    assert.match(rules('test'), /- 근거: 측정 2026-10-27 — gimi 없이 1번 중 1번 · gimi 있이 1번 중 1번/)
    // 영역이 없는 결과 파일(구현 실행)은 리뷰 줄을 건드리지 않는다
    assert.match(rules('review'), /- 근거: 측정 전/)
    const table = (args) => spawnSync(process.execPath, [join(ROOT, 'scripts/buildSlopTable.mjs'), ...args], { encoding: 'utf8' })
    assert.equal(table(['--check', '--root', root]).status, 1)
    assert.equal(table(['--root', root]).status, 0)
    assert.equal(table(['--check', '--root', root]).status, 0)
    const skill = readFileSync(join(root, 'skills/gimi-review/SKILL.md'), 'utf8')
    assert.match(skill, /\| `test\/tautology` 늘 참인 단언을 쓰지 않는다 \| 1번 중 1번 \| 1번 중 1번 \|/)
    assert.match(skill, /\| `code\/fire-and-forget` 비동기 작업을 기다리지 않는다 \| 1번 중 1번 \| 1번 중 0번 \|/)
  })

  it('apply — 결과 파일에 영역이 있으면 그 영역의 규칙 파일만 바꾼다', () => {
    const root = join(out, 'root')
    const before = readFileSync(join(root, 'skills/gimi-review/shared/rules/code.md'), 'utf8')
    const applied = run(['apply', join(out, 'results-test.json'), '--root', root])
    assert.equal(applied.status, 0, applied.stdout + applied.stderr)
    assert.match(readFileSync(join(root, 'skills/gimi-review/shared/rules/test.md'), 'utf8'), /- 근거: 측정 2026-10-28 — gimi 없이 1번 중 1번 · gimi 있이 1번 중 1번/)
    assert.equal(readFileSync(join(root, 'skills/gimi-review/shared/rules/code.md'), 'utf8'), before)
  })

  it('judge·score --reviews — 리뷰 평가의 실행(code-review는 gimi 없이, gimi는 있이)을 리뷰 줄로 판정하고 센다', () => {
    const dir = join(out, 'reviews')
    repo.write({
      'defects/COM-007/defect.json': JSON.stringify({ id: 'COM-007', rules: ['COM-007'], context: '도메인 규칙', layer: '백엔드', pr: { title: 'feat: 재고 부족을 알린다', body: 'closes #41' }, issues: [{ number: 41, title: '재고 알림', body: '확인과 차감은 한 번에' }], findings: [] }),
      'defects/COM-007/change.patch': 'diff --git a/web/src/cart.ts b/web/src/cart.ts\n+export const x = 1\n',
    })
    const record = (reviewer) => ({ reviewer, id: 'COM-007', run: 1, output: '잘 작성됐습니다.\nFINDING 없음', commands: [{ command: 'git diff main...HEAD', status: 'ok', output: '' }] })
    mkdirSync(join(dir, 'code-review'), { recursive: true })
    mkdirSync(join(dir, 'gimi/COM-007-1/docs/gimi/reviews'), { recursive: true })
    writeFileSync(join(dir, 'code-review/COM-007-1.json'), JSON.stringify(record('code-review')))
    writeFileSync(join(dir, 'gimi/COM-007-1.json'), JSON.stringify(record('gimi')))
    writeFileSync(join(dir, 'gimi/COM-007-1/docs/gimi/reviews/2026-10-29.md'), '## 맥락\n- 건너뜀: 이력\n')

    const judged = run(['judge', dir, '--reviews', '--fixture', repo.dir, '--claude', fake])
    assert.equal(judged.status, 0, judged.stdout + judged.stderr)
    const calls = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((call) => call.mode === 'judge-review')
    assert.equal(calls.length, 2)
    for (const call of calls) for (const part of ['feat: 재고 부족을 알린다', '확인과 차감은 한 번에', '+export const x = 1', '잘 작성됐습니다.', '- 성공 `git diff main...HEAD`']) assert.ok(call.stdin.includes(part), part)
    // 리뷰 줄만 판정한다 — 구현 줄(code·test)은 넣지 않는다
    assert.doesNotMatch(calls[0].stdin, /## (?:code|test)\//)
    // gimi 쪽만 리뷰 기록이 있다
    assert.equal(calls.filter((call) => call.stdin.includes('건너뜀: 이력')).length, 1)

    const scored = run(['score', dir, '--reviews', '--results', join(out, 'results-review.json'), '--date', '2026-10-29'])
    assert.equal(scored.status, 0, scored.stdout + scored.stderr)
    assert.match(scored.stdout, /\| `review\/filler` [^|]+\| 리뷰 \| [^|]+\| 1\/1 \| 1\/1 \|/)
    const results = JSON.parse(readFileSync(join(out, 'results-review.json'), 'utf8'))
    assert.deepEqual([results.areas, results.runs], [['review'], { without: 1, with: 1 }])

    // 근거를 리뷰 규칙 파일에 쓰고, gimi-review SKILL.md 표에 리뷰 줄이 올라간다
    const root = join(out, 'root')
    assert.equal(run(['apply', join(out, 'results-review.json'), '--root', root]).status, 0)
    assert.match(readFileSync(join(root, 'skills/gimi-review/shared/rules/review.md'), 'utf8'), /- 근거: 측정 2026-10-29 — gimi 없이 1번 중 1번 · gimi 있이 1번 중 1번/)
    assert.equal(spawnSync(process.execPath, [join(ROOT, 'scripts/buildSlopTable.mjs'), '--root', root], { encoding: 'utf8' }).status, 0)
    assert.match(readFileSync(join(root, 'skills/gimi-review/SKILL.md'), 'utf8'), /\| `review\/filler` 칭찬과 요약을 쓰지 않는다 \| 1번 중 1번 \| 1번 중 1번 \|/)
  })
})
