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
    assert.match(text, /^보고 {6}.*명령·종료 코드·결과 수.*기본 브랜치에서 같은 명령/m)
  })

  it('돌린 명령이 없으면 그렇다고 쓴다', () => {
    const empty = { ...report(), runs: [], skipped: [{ name: '전체', cwd: '', reason: '검사할 바뀐 파일이 없다' }] }
    assert.match(renderCheckReport({ report: empty }), /^결과 {6}돌린 명령 없음 · 건너뜀 1$/m)
  })
})
