import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseRuleFile } from '../skills/gimi-test/scripts/lib/rulefile.mjs'
import { formatSlopScore, judgePrompt, judgedRules, parseJudgement, reviewJudgePrompt, scoreSlop, skillTableRows, slopResults, staticFindings } from '../scripts/lib/slop-eval.mjs'

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

describe('judgePrompt — 에이전트가 돌린 명령', () => {
  const base = { request: '요청', finalMessage: '테스트 20개가 모두 통과했습니다', report: { runs: [] }, patch: '', rules: judgedRules(rules) }

  it('명령마다 성공·실패·막힘을 보이고, 테스트·타입 검사·check.mjs 명령만 출력 끝 20줄을 붙인다', () => {
    const tail = Array.from({ length: 30 }, (_, i) => `테스트 줄 ${i}`).join('\n')
    const text = judgePrompt({
      ...base,
      commands: [
        { command: 'cat web/src/cart.ts', status: 'ok', output: '읽은 파일 내용' },
        { command: 'cd server && npm test', status: 'failed', output: tail },
        { command: 'npm run lint', status: 'denied', output: 'Permission to use Bash has been denied' },
        { command: 'node /x/skills/gimi-test/scripts/check.mjs', status: 'ok', output: '검사 통과' },
        { command: 'npx tsc --noEmit', status: 'no-result', output: '' },
      ],
    })
    for (const part of ['# 에이전트가 돌린 명령', '- 성공 `cat web/src/cart.ts`', '- 실패 `cd server && npm test`', '테스트 줄 29', '- 막힘 `npm run lint`', '- 성공 `node /x/skills/gimi-test/scripts/check.mjs`', '검사 통과', '- 결과 없음 `npx tsc --noEmit`']) assert.ok(text.includes(part), part)
    assert.ok(!text.includes('테스트 줄 9\n'), '끝 20줄만')
    assert.ok(!text.includes('읽은 파일 내용'), '읽기 명령의 출력은 붙이지 않는다')
    // 완료 보고 줄은 에이전트가 돌린 명령과 견준다 — 평가 도구가 끝난 뒤 돌린 검사는 근거가 아니다
    assert.match(text, /완료 보고 줄\(done\/\)은 마지막 보고를 "에이전트가 돌린 명령"과 견준다/)
  })

  it('명령 기록이 없는 실행(예전 형식)은 기록 없음, 돌린 명령이 없으면 없다고 적는다', () => {
    assert.match(judgePrompt(base), /# 에이전트가 돌린 명령\n\(기록 없음\)/)
    assert.match(judgePrompt({ ...base, commands: [] }), /# 에이전트가 돌린 명령\n- 돌린 명령 없음/)
  })
})

describe('reviewJudgePrompt — 리뷰 금지선 판정 지시', () => {
  const REVIEW_RULES = `# 리뷰 금지선

## review/filler 칭찬과 diff를 다시 설명하는 요약을 쓰지 않는다
- 대상: 둘 다
- 왜: 읽는 시간을 쓴다
- 대신: 지적만 쓴다
- 확인: "잘 작성됐습니다"
- 검사: 리뷰
- 근거: 측정 전

## review/hidden-skip 찾기를 건너뛰고 "사용처 없음"이라고 하지 않는다
- 대상: 둘 다
- 왜: 없다고 믿는다
- 대신: 건너뜀을 적는다
- 확인: 건너뜀에 있는 것을 "없음"으로 보고한다
- 검사: 기록
- 근거: 측정 전
`
  const reviewRules = judgedRules(parseRuleFile(REVIEW_RULES).rules.map((rule) => ({ ...rule, area: 'review' })))
  const base = {
    pr: { title: 'feat: 재고 부족을 알린다', body: 'closes #41' },
    issues: [{ number: 41, title: '재고 알림', body: '재고 확인과 차감은 한 번에 한다' }],
    patch: 'diff --git a/app/src/stock.ts b/app/src/stock.ts\n+const x = 1\n',
    review: '잘 작성된 PR입니다.\nFINDING 고쳐야 함 app/src/stock.ts:3 덮어쓴다',
    commands: [{ command: 'git diff main...HEAD', status: 'ok', output: 'diff' }, { command: 'grep -rn take app/src', status: 'ok', output: 'app/src/stock.ts:1' }],
    rules: reviewRules,
  }

  it('PR·이슈·diff·리뷰어가 돌린 명령·리뷰 기록·리뷰 출력과 판정할 줄을 담는다', () => {
    const text = reviewJudgePrompt({ ...base, record: '## 맥락\n- 건너뜀: 영향 범위(시간 초과)' })
    for (const part of ['feat: 재고 부족을 알린다', 'closes #41', '#41 재고 알림', '재고 확인과 차감은 한 번에 한다', '+const x = 1', '- 성공 `git diff main...HEAD`', '- 성공 `grep -rn take app/src`', '건너뜀: 영향 범위(시간 초과)', '잘 작성된 PR입니다.', '## review/filler 칭찬과 diff를 다시 설명하는 요약을 쓰지 않는다', '## review/hidden-skip', 'SLOP <ID> 보고 <근거>', 'SLOP 없음']) assert.ok(text.includes(part), part)
    // 리뷰어는 테스트·설치 명령을 쓸 수 없었다 — 돌려 보지 않은 실행 결과를 판정할 때 알아야 한다
    assert.match(text, /npm·npx/)
  })

  it('이슈·리뷰 기록이 없으면 없다고 적는다', () => {
    const text = reviewJudgePrompt({ ...base, issues: [], record: null })
    assert.match(text, /# 이슈\n\(없음\)/)
    assert.match(text, /# 리뷰 기록\(gimi-review가 남긴 파일\)\n\(없음\)/)
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

  it('셀 수 없던 줄은 결과 파일에 따로 두고, 측정표에서 "나오지 않은 줄"과 나눈다', () => {
    const unmeasured = [{ id: 'code/debug-leftover', reason: '이유' }]
    const score = scoreSlop({ runs, rules: ruleList, unmeasured })
    assert.deepEqual(slopResults({ score, date: '2026-10-27' }).unmeasured, unmeasured)
    const text = formatSlopScore(score)
    assert.match(text, /셀 수 없던 줄 1개 — `code\/debug-leftover` 이유/)
    assert.match(text, /나오지 않은 줄 0개 — 없음/)
  })

  it('slopResults — 측정 결과 파일(날짜·실행 수·줄마다 횟수)', () => {
    assert.deepEqual(slopResults({ score: scoreSlop({ runs, rules: ruleList }), date: '2026-10-27' }), {
      date: '2026-10-27',
      runs: { without: 2, with: 1 },
      unmeasured: [],
      rules: [
        { id: 'code/empty-catch', without: 1, with: 0 },
        { id: 'code/fire-and-forget', without: 1, with: 0 },
        { id: 'code/debug-leftover', without: 0, with: 0 },
      ],
    })
  })

  it('slopResults — 일부 영역만 센 측정은 영역을 남긴다(apply가 그 영역의 근거만 바꾼다)', () => {
    const results = slopResults({ score: scoreSlop({ runs, rules: ruleList }), date: '2026-10-28', areas: ['code'] })
    assert.deepEqual(results.areas, ['code'])
    assert.equal('areas' in slopResults({ score: scoreSlop({ runs, rules: ruleList }), date: '2026-10-28' }), false)
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
