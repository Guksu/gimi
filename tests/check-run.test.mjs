import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCounts, runCheck } from '../skills/gimi-test/scripts/lib/run.mjs'

describe('parseCounts', () => {
  it('Vitest 요약을 읽는다', () => {
    assert.deepEqual(parseCounts(' Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 10 passed | 1 skipped (13)\n'), { passed: 10, failed: 2, skipped: 1, unit: '테스트' })
    assert.deepEqual(parseCounts('      Tests  12 passed (12)\n'), { passed: 12, failed: 0, skipped: 0, unit: '테스트' })
  })

  it('Jest 요약을 읽는다', () => {
    assert.deepEqual(parseCounts('Tests:       1 failed, 2 skipped, 10 passed, 13 total\n'), { passed: 10, failed: 1, skipped: 2, unit: '테스트' })
  })

  it('node:test(TAP) 요약을 읽는다', () => {
    assert.deepEqual(parseCounts('# tests 5\n# pass 4\n# fail 1\n# skipped 0\n'), { passed: 4, failed: 1, skipped: 0, unit: '테스트' })
  })

  it('pytest 요약을 읽는다', () => {
    assert.deepEqual(parseCounts('===== 1 failed, 10 passed, 2 skipped in 0.52s =====\n'), { passed: 10, failed: 1, skipped: 2, unit: '테스트' })
  })

  it('Maven은 마지막 Tests run 줄(전체 합계)을 읽는다', () => {
    const out = 'Tests run: 3, Failures: 0, Errors: 0, Skipped: 0\nResults:\nTests run: 10, Failures: 1, Errors: 1, Skipped: 2\n'
    assert.deepEqual(parseCounts(out), { passed: 6, failed: 2, skipped: 2, unit: '테스트' })
  })

  it('Gradle 실패 요약을 읽는다', () => {
    assert.deepEqual(parseCounts('12 tests completed, 2 failed, 1 skipped\nBUILD FAILED\n'), { passed: 9, failed: 2, skipped: 1, unit: '테스트' })
  })

  it('Go는 패키지 단위로 센다', () => {
    assert.deepEqual(parseCounts('ok  \texample.com/x/a\t0.01s\nFAIL\texample.com/x/b\t0.02s\nok  \texample.com/x/c\t(cached)\n'), { passed: 2, failed: 1, skipped: 0, unit: '패키지' })
  })

  it('색 코드는 무시하고, 아무것도 못 읽으면 null이다', () => {
    assert.deepEqual(parseCounts('\u001b[32m      Tests  3 passed (3)\u001b[39m\n'), { passed: 3, failed: 0, skipped: 0, unit: '테스트' })
    assert.equal(parseCounts('done\n'), null)
  })
})

describe('runCheck', () => {
  let root
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gimi-run-'))
    mkdirSync(join(root, 'sub'))
  })
  after(() => rmSync(root, { recursive: true, force: true }))

  const node = (code) => `node -e ${JSON.stringify(code)}`

  it('종료 코드 0이면 통과, 시간과 결과 수를 남긴다', async () => {
    const result = await runCheck({ root, check: { name: 'test', cwd: '', scope: 'all', command: node("console.log('# pass 3'); console.log('# fail 0')") } })
    assert.equal(result.status, 'pass')
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.counts, { passed: 3, failed: 0, skipped: 0, unit: '테스트' })
    assert.ok(result.durationMs >= 0)
  })

  it('0이 아니면 실패이고 출력 끝을 남긴다', async () => {
    const result = await runCheck({ root, check: { name: 'test', cwd: '', scope: 'all', command: node("console.error('boom'); process.exit(3)") } })
    assert.equal(result.status, 'fail')
    assert.equal(result.exitCode, 3)
    assert.match(result.outputTail.join('\n'), /boom/)
  })

  it('시간을 넘기면 멈추고 timeout으로 적는다', async () => {
    const result = await runCheck({ root, check: { name: 'test', cwd: '', scope: 'all', command: node('setTimeout(() => {}, 10000)'), timeoutMs: 300 } })
    assert.equal(result.status, 'timeout')
  })

  it('묶음 폴더(cwd)에서 돌리고, 하위 명령에 GIMI_CHECK_RUNNING을 넘겨 check.mjs가 다시 불려도 알아보게 한다', async () => {
    const result = await runCheck({ root, check: { name: 'test', cwd: 'sub', scope: 'all', command: node('console.log(process.cwd()); console.log(process.env.GIMI_CHECK_RUNNING)') } })
    assert.match(result.outputTail[0], /sub$/)
    assert.equal(result.outputTail[1], '1')
  })
})
