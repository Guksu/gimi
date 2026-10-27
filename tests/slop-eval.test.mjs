import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseRuleFile } from '../skills/gimi-test/scripts/lib/rulefile.mjs'
import { formatSlopScore, judgePrompt, judgedRules, parseJudgement, scoreSlop, skillTableRows, slopResults, staticFindings } from '../scripts/lib/slop-eval.mjs'

const RULES = `# 코드 금지선

## code/empty-catch 빈 catch로 오류를 삼키지 않는다
- 대상: 둘 다
- 왜: 실패해도 아무도 모른다
- 대신: 다시 던진다
- 확인: 본문이 빈 catch
- 검사: error(빈 catch) + 리뷰
- 근거: 측정 전

## code/fire-and-forget 비동기 작업을 기다리지 않는다
- 대상: 백엔드
- 왜: 실패가 사라진다
- 대신: 기다리거나 큐로 보낸다
- 확인: await 없이 부른 Promise
- 검사: 리뷰
- 근거: 측정 전

## code/debug-leftover 디버그 흔적을 남기지 않는다
- 대상: 둘 다
- 왜: 로그가 샌다
- 대신: 지운다
- 확인: console.log
- 검사: warn
- 근거: 측정 전
`
const rules = parseRuleFile(RULES).rules.map((rule) => ({ ...rule, area: 'code' }))

describe('judgedRules — 판정 모델이 볼 줄', () => {
  it('검사가 error·warn만인 줄은 뺀다 — 리뷰가 섞인 줄은 판정한다', () => {
    assert.deepEqual(judgedRules(rules).map((rule) => rule.id), ['code/empty-catch', 'code/fire-and-forget'])
    assert.equal(judgedRules(rules)[1].confirm, 'await 없이 부른 Promise')
  })
})

describe('judgePrompt — 판정 지시', () => {
  it('요청·보고·검사 결과·diff·규칙을 담고, 답 형식을 정한다', () => {
    const text = judgePrompt({
      request: '주문 생성 API에 메모를 더해 줘',
      finalMessage: '구현했고 테스트가 통과했습니다',
      report: { runs: [{ name: 'test', cwd: 'server', status: 'fail', counts: { failed: 1 } }], slop: { findings: [{ id: 'code/debug-leftover', path: 'server/src/a.ts', line: 3 }] } },
      patch: 'diff --git a/server/src/a.ts b/server/src/a.ts\n+console.log(1)\n',
      rules: judgedRules(rules),
    })
    for (const part of ['주문 생성 API에 메모를 더해 줘', '구현했고 테스트가 통과했습니다', 'test(server) fail', 'code/debug-leftover server/src/a.ts:3', '+console.log(1)', '## code/fire-and-forget 비동기 작업을 기다리지 않는다', '- 확인: await 없이 부른 Promise', 'SLOP <ID> <경로>:<줄> <근거>', 'SLOP <ID> 보고 <근거>', 'SLOP 없음']) assert.ok(text.includes(part), part)
    assert.ok(!text.includes('## code/debug-leftover'), '자동 검사만 하는 줄은 판정 목록에 넣지 않는다')
  })
})

describe('parseJudgement — 판정 모델의 답', () => {
  it('위치·보고 지적을 읽고, 목록에 없는 ID는 따로 모은다', () => {
    const text = ['살펴봤습니다.', 'SLOP code/fire-and-forget server/src/a.ts:12 sendMail을 기다리지 않는다', '- SLOP done/no-run-claim 보고 돌리지 않은 테스트를 통과했다고 썼다', 'SLOP code/made-up a.ts:1 x'].join('\n')
    assert.deepEqual(parseJudgement(text, { ids: ['code/fire-and-forget', 'done/no-run-claim'] }), {
      declared: true,
      findings: [
        { id: 'code/fire-and-forget', path: 'server/src/a.ts', line: 12, reason: 'sendMail을 기다리지 않는다' },
        { id: 'done/no-run-claim', path: '보고', line: null, reason: '돌리지 않은 테스트를 통과했다고 썼다' },
      ],
      unknown: ['code/made-up'],
    })
    assert.deepEqual(parseJudgement('SLOP 없음', { ids: [] }), { declared: true, findings: [], unknown: [] })
    assert.equal(parseJudgement('형식 없는 답', { ids: [] }).declared, false)
  })
})

describe('staticFindings — check.mjs 보고의 슬롭', () => {
  it('지적의 ID·위치를 꺼낸다. 보고가 없으면 빈 목록', () => {
    assert.deepEqual(staticFindings({ slop: { findings: [{ id: 'test/tautology', severity: 'warn', path: 'web/a.test.ts', line: 4, message: 'x' }] } }), [{ id: 'test/tautology', path: 'web/a.test.ts', line: 4 }])
    assert.deepEqual(staticFindings(null), [])
  })
})

describe('scoreSlop — 줄마다 몇 번의 실행에서 나왔나', () => {
  const runs = [
    { arm: 'without', request: 'B1', run: 1, report: { slop: { findings: [{ id: 'code/empty-catch', path: 'a.ts', line: 1 }, { id: 'code/empty-catch', path: 'a.ts', line: 9 }] } }, judgement: { declared: true, findings: [{ id: 'code/empty-catch', path: 'a.ts', line: 1 }, { id: 'code/fire-and-forget', path: 'a.ts', line: 5 }] } },
    { arm: 'without', request: 'F1', run: 1, report: { slop: { findings: [] } }, judgement: { declared: true, findings: [] } },
    { arm: 'with', request: 'B1', run: 1, report: { slop: { findings: [] } }, judgement: null },
  ]
  const ruleList = rules.map((rule) => ({ id: rule.id, title: rule.title, area: rule.area, check: rule.items.get('검사').value }))

  it('한 실행에서 여러 번 나와도 한 번으로 센다 — 자동 검사와 판정이 같은 줄을 찾아도', () => {
    const score = scoreSlop({ runs, rules: ruleList })
    assert.deepEqual(score.arms, { without: { runs: 2, judged: 2 }, with: { runs: 1, judged: 0 } })
    const byId = Object.fromEntries(score.rules.map((rule) => [rule.id, rule]))
    assert.deepEqual([byId['code/empty-catch'].without, byId['code/empty-catch'].with], [1, 0])
    assert.deepEqual([byId['code/fire-and-forget'].without, byId['code/debug-leftover'].without], [1, 0])
  })

  it('걸러 낸 지적(rejected)은 세지 않는다 — 같은 실행·같은 줄·같은 위치여야 뺀다', () => {
    const rejected = [
      { arm: 'without', request: 'B1', run: 1, id: 'code/fire-and-forget', path: 'a.ts', line: 5, reason: '기다린다 — 판정이 틀렸다' },
      { arm: 'without', request: 'B1', run: 1, id: 'code/empty-catch', path: 'a.ts', line: 1, reason: '로그를 남긴다' },
    ]
    const byId = Object.fromEntries(scoreSlop({ runs, rules: ruleList, rejected }).rules.map((rule) => [rule.id, rule]))
    assert.equal(byId['code/fire-and-forget'].without, 0)
    // 같은 줄의 다른 위치(a.ts:9, 자동 검사)는 남는다
    assert.equal(byId['code/empty-catch'].without, 1)
  })

  it('slopResults — 측정 결과 파일(날짜·실행 수·줄마다 횟수)', () => {
    assert.deepEqual(slopResults({ score: scoreSlop({ runs, rules: ruleList }), date: '2026-10-27' }), {
      date: '2026-10-27',
      runs: { without: 2, with: 1 },
      rules: [
        { id: 'code/empty-catch', without: 1, with: 0 },
        { id: 'code/fire-and-forget', without: 1, with: 0 },
        { id: 'code/debug-leftover', without: 0, with: 0 },
      ],
    })
  })

  it('formatSlopScore — 나온 줄은 표로, 나오지 않은 줄은 이름만', () => {
    const text = formatSlopScore(scoreSlop({ runs, rules: ruleList }))
    assert.match(text, /\| `code\/empty-catch` 빈 catch로 오류를 삼키지 않는다 \| 코드 \| error\(빈 catch\) \+ 리뷰 \| 1\/2 \| 0\/1 \|/)
    assert.match(text, /나오지 않은 줄 1개 — `code\/debug-leftover`/)
    assert.match(text, /판정하지 못한 실행 — gimi 있이 1/)
  })

  it('skillTableRows — gimi 없이에서 한 번 이상 나온 줄만, 많이 나온 순으로 "N번 중 M번"', () => {
    assert.deepEqual(skillTableRows(scoreSlop({ runs, rules: ruleList })), [
      { id: 'code/empty-catch', title: '빈 catch로 오류를 삼키지 않는다', area: 'code', evidence: '2번 중 1번' },
      { id: 'code/fire-and-forget', title: '비동기 작업을 기다리지 않는다', area: 'code', evidence: '2번 중 1번' },
    ])
  })
})
