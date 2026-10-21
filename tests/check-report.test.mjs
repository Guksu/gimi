import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderCheckReport } from '../skills/gimi-test/scripts/lib/report.mjs'

const report = () => ({
  version: 1,
  scope: {
    baseRef: 'origin/main',
    mergeBase: 'e'.repeat(40),
    files: [
      { path: 'src/a.ts', status: 'M', sources: ['commit'] },
      { path: 'src/b.ts', status: 'M', sources: ['commit', 'worktree'] },
      { path: 'src/c.ts', status: 'A', sources: ['untracked'] },
    ],
  },
  source: 'detected',
  runs: [
    { name: 'test', cwd: '', scope: 'related', command: 'npx vitest related --run src/a.ts', status: 'pass', exitCode: 0, durationMs: 3200, counts: { passed: 12, failed: 0, skipped: 1, unit: '테스트' }, outputTail: [] },
    { name: 'typecheck', cwd: 'packages/web', scope: 'all', command: 'npx tsc --noEmit -p tsconfig.json', status: 'fail', exitCode: 2, durationMs: 5100, counts: null, outputTail: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', "src/a.ts(3,5): error TS2322: Type 'string' is not assignable"] },
    { name: 'e2e', cwd: '', scope: 'config', command: 'npm run e2e', status: 'timeout', exitCode: null, durationMs: 600000, counts: null, outputTail: [] },
  ],
  skipped: [{ name: 'lint', cwd: '', reason: 'lint 스크립트가 없다' }],
})

describe('renderCheckReport', () => {
  const text = renderCheckReport({ report: report() })

  it('바뀐 파일 수를 출처별로, 기준과 갈림점을 첫 줄에 쓴다', () => {
    assert.match(text.split('\n')[0], /^끝내기 전 검사 {2}바뀐 파일 3개\(커밋 2 · 작업 트리 1 · 새 파일 1\) — 기준 origin\/main, 갈림점 eeeeeee$/)
  })

  it('명령을 어디서 찾았는지 쓴다', () => {
    assert.match(text, /^명령 출처 {2}프로젝트 파일 감지$/m)
  })

  it('명령마다 결과·범위·명령·시간·결과 수(또는 종료 코드)를 한 줄로 쓴다 — 묶음 폴더가 있으면 함께', () => {
    assert.match(text, /^통과 {6}test\(관련 테스트만\) {2}npx vitest related --run src\/a\.ts {2}\(3\.2초 · 통과 12 · 실패 0 · 건너뜀 1\)$/m)
    assert.match(text, /^실패 {6}typecheck\(전체\) {2}\[packages\/web\] npx tsc --noEmit -p tsconfig\.json {2}\(5\.1초 · 종료 코드 2\)$/m)
    assert.match(text, /^시간 초과 {2}e2e\(설정대로\) {2}npm run e2e {2}\(600\.0초에서 멈춤\)$/m)
  })

  it('실패한 명령은 출력 끝 5줄을 붙인다', () => {
    assert.match(text, /^ {10}src\/a\.ts\(3,5\): error TS2322/m)
    assert.doesNotMatch(text, /^ {10}l1$/m)
  })

  it('건너뛴 검사와 이유, 합계, 보고할 때 지킬 것을 쓴다', () => {
    assert.match(text, /^건너뜀 {4}lint — lint 스크립트가 없다$/m)
    assert.match(text, /^결과 {6}통과 1 · 실패 1 · 시간 초과 1 · 건너뜀 1$/m)
    assert.match(text, /^보고 {6}.*명령·종료 코드·결과 수.*--baseline으로 기준\(갈림점\)에서 같은 명령/m)
  })

  it('돌린 명령이 없으면 그렇다고 쓴다', () => {
    const empty = { ...report(), runs: [], skipped: [{ name: '전체', cwd: '', reason: '검사할 바뀐 파일이 없다' }] }
    assert.match(renderCheckReport({ report: empty }), /^결과 {6}돌린 명령 없음 · 건너뜀 1$/m)
  })
})

describe('renderCheckReport — 슬롭 검사', () => {
  const finding = (id, severity, path, line, message, extra = {}) => ({ id, severity, path, line, message, excerpt: '', ...extra })
  const withSlop = (slop) => ({ ...report(), slop })
  const slop = {
    checked: { test: 2, code: 3, snapshot: 0 },
    findings: [
      finding('test/only-left', 'error', 'src/cart.test.ts', 12, '.only가 남아 있다 — 지운다'),
      finding('test/real-wait', 'warn', 'src/cart.test.ts', 48, '고정하지 않은 현재 시각에 기댄다 — setSystemTime으로 고정한다'),
      finding('test/real-wait', 'warn', 'src/cart.test.ts', 60, '고정하지 않은 현재 시각에 기댄다 — setSystemTime으로 고정한다'),
      finding('test/real-wait', 'warn', 'src/cart.test.ts', 71, '고정하지 않은 현재 시각에 기댄다 — setSystemTime으로 고정한다'),
      finding('code/debug-leftover', 'warn', 'src/pay.ts', 3, 'console.log가 남았다 — 지운다', { note: '무시 주석에 이유가 없어 무시하지 않았다' }),
      finding('done/test-bent', 'warn', 'src/pay.test.ts', 9, '이 변경에서 테스트를 건너뛰게 했다 — 보고에 밝힌다', { disclose: true }),
    ],
    ignored: [{ ...finding('code/type-escape', 'warn', 'src/api.ts', 40, 'as any'), reason: 'SDK 타입이 틀렸다(#40)' }],
  }
  const text = renderCheckReport({ report: withSlop(slop) })

  it('본 파일 수와 error·warn·무시 수를 머리에 쓴다', () => {
    assert.match(text, /^슬롭 검사 {2}바뀐 파일 5개\(테스트 2 · 코드 3\) — error 1 · warn 5 · 무시 1$/m)
  })

  it('지적마다 등급·ID·위치·내용을 한 줄로 쓰고, 같은 파일의 같은 지적은 첫 줄에 묶어 "외 N곳"으로 쓴다', () => {
    assert.match(text, /^error {5}test\/only-left {2}src\/cart\.test\.ts:12 {2}\.only가 남아 있다 — 지운다$/m)
    assert.match(text, /^warn {6}test\/real-wait {2}src\/cart\.test\.ts:48 외 2곳 {2}고정하지 않은 현재 시각/m)
    assert.doesNotMatch(text, /cart\.test\.ts:60/)
  })

  it('error를 warn보다 먼저 쓰고, 이유 없는 무시 주석은 지적 아래에 밝힌다', () => {
    assert.ok(text.indexOf('error     test/only-left') < text.indexOf('warn      test/real-wait'))
    assert.match(text, /^warn {6}code\/debug-leftover {2}src\/pay\.ts:3 {2}console\.log가 남았다 — 지운다\n {10}무시 주석에 이유가 없어 무시하지 않았다$/m)
  })

  it('무시한 지적은 이유와 함께 쓴다', () => {
    assert.match(text, /^무시 {6}code\/type-escape {2}src\/api\.ts:40 — SDK 타입이 틀렸다\(#40\)$/m)
  })

  it('결과 줄에 슬롭 수를 더하고, 보고에서 error는 고치고 건너뛰게 한 테스트·바꾼 기대값은 밝히라고 쓴다', () => {
    assert.match(text, /^결과 {6}통과 1 · 실패 1 · 시간 초과 1 · 건너뜀 1 · 슬롭 error 1 · warn 5$/m)
    assert.match(text, /^보고 {6}.*슬롭 error는 고친 뒤 다시 돌린다/m)
    assert.match(text, /^보고 {6}.*건너뛰게 한 테스트·바꾼 기대값·갱신한 스냅샷/m)
  })

  it('지적이 없으면 그렇다고 쓰고, 볼 파일이 없으면 그것도 쓴다', () => {
    assert.match(renderCheckReport({ report: withSlop({ ...slop, findings: [], ignored: [] }) }), /^슬롭 검사 {2}바뀐 파일 5개\(테스트 2 · 코드 3\) — 지적 없음$/m)
    assert.match(renderCheckReport({ report: withSlop({ checked: { test: 0, code: 0, snapshot: 0 }, findings: [], ignored: [] }) }), /^슬롭 검사 {2}바뀐 JS·TS 파일 없음$/m)
  })

  it('warn이 많으면 앞의 40줄만 쓰고 나머지 수와 --json을 안내한다 — error는 모두 쓴다', () => {
    const many = Array.from({ length: 45 }, (_, i) => finding('code/debug-leftover', 'warn', `src/f${i}.ts`, 1, 'console.log가 남았다'))
    const long = renderCheckReport({ report: withSlop({ ...slop, findings: [...many, finding('test/only-left', 'error', 'src/z.test.ts', 1, '.only')] }) })
    assert.match(long, /^error {5}test\/only-left {2}src\/z\.test\.ts:1/m)
    assert.match(long, /^ {10}warn 5줄 더 — --json으로 모두 본다$/m)
    assert.doesNotMatch(long, /src\/f44\.ts/)
  })
})

describe('renderCheckReport — 기준 비교(--baseline)', () => {
  const failing = report().runs[1]
  const withBaseline = (base, extra = {}) => ({ ...report(), runs: [report().runs[0], { ...failing, baseline: base }], baseline: { mergeBase: 'e'.repeat(40), ...extra } })

  it('실패한 명령 아래에 기준 결과를 쓴다 — 기준에서 통과하면 이 변경에서 생긴 실패다', () => {
    const text = renderCheckReport({ report: withBaseline({ verdict: 'new', message: '기준에서는 통과한다 — 이 변경에서 생긴 실패다', status: 'pass', exitCode: 0, durationMs: 2100, counts: { passed: 3, failed: 0, skipped: 0, unit: '테스트' }, outputTail: [] }) })
    assert.match(text, /^ {10}src\/a\.ts\(3,5\): error TS2322.*\n기준 {6}기준에서는 통과한다 — 이 변경에서 생긴 실패다 {2}\(2\.1초 · 통과 3 · 실패 0 · 건너뜀 0\)$/m)
  })

  it('기준에서도 실패하면 기준 출력 끝도 붙여 비교하게 한다', () => {
    const text = renderCheckReport({ report: withBaseline({ verdict: 'preexisting', message: '기준에서도 실패한다 — 원래 있던 실패일 수 있다', status: 'fail', exitCode: 2, durationMs: 4000, counts: null, outputTail: ['base-1', "src/a.ts(9,1): error TS1005"] }) })
    assert.match(text, /^기준 {6}기준에서도 실패한다 — 원래 있던 실패일 수 있다 {2}\(4\.0초 · 종료 코드 2\)\n {10}base-1\n {10}src\/a\.ts\(9,1\): error TS1005$/m)
  })

  it('기준에서 돌리지 않은 이유(볼 파일 없음·준비 실패)는 시간 없이 쓴다', () => {
    const text = renderCheckReport({ report: withBaseline({ verdict: 'new', message: '기준에는 이 검사가 볼 파일이 없다 — 이 변경에서 생긴 실패다' }) })
    assert.match(text, /^기준 {6}기준에는 이 검사가 볼 파일이 없다 — 이 변경에서 생긴 실패다$/m)
  })

  it('실패가 없으면 기준에서 돌리지 않았다고 쓰고, 의존성 파일이 바뀌었으면 그 한계를 쓴다', () => {
    const passing = { ...report(), runs: [report().runs[0]], baseline: { mergeBase: 'e'.repeat(40), dependenciesChanged: true } }
    const text = renderCheckReport({ report: passing })
    assert.match(text, /^기준 {6}실패한 명령이 없어 기준\(갈림점 eeeeeee\)에서 돌리지 않았다$/m)
    assert.doesNotMatch(text, /의존성 파일/)
    assert.match(renderCheckReport({ report: withBaseline({ verdict: 'new', message: 'x', status: 'pass', exitCode: 0, durationMs: 1, counts: null, outputTail: [] }, { dependenciesChanged: true }) }), /^기준 {6}의존성 파일\(package\.json·잠금 파일\)이 바뀌었다 — 기준도 지금의 node_modules로 돌렸다$/m)
  })

  it('기준을 돌렸으면 보고에서 기본 브랜치에서 돌려 보라는 말 대신 기준 줄을 붙이라고 쓴다', () => {
    const text = renderCheckReport({ report: withBaseline({ verdict: 'new', message: 'x', status: 'pass', exitCode: 0, durationMs: 1, counts: null, outputTail: [] }) })
    assert.match(text, /^보고 {6}.*"원래 있던 실패"라고 하려면 기준 줄을 그대로 붙인다/m)
  })
})
