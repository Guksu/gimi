import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { coverageOf, formatScore, hunksOf, locateFinding, matchFindings, parseFindings, scoreRuns } from '../scripts/lib/review-eval.mjs'

const ROOT = '/tmp/shop-a1b2'
const defect = (overrides = {}) => ({
  id: 'COM-024',
  layer: '둘 다',
  context: '영향 범위',
  findings: [
    {
      level: '고쳐야 함',
      summary: 'canCancel이 빠진다',
      path: 'server/src/orders/orders.service.ts',
      line: 143,
      evidence: [
        { path: 'contracts/openapi.yaml', line: 365 },
        { path: 'web/src/pages/OrderPage.tsx', line: 72 },
      ],
    },
  ],
  ...overrides,
})

describe('parseFindings — 리뷰 출력의 FINDING 줄', () => {
  it('단계·경로·줄(범위)·요약을 읽는다 — 백틱·./·저장소 절대 경로는 뗀다', () => {
    const text = [
      '리뷰를 마쳤습니다.',
      'FINDING 고쳐야 함 server/src/orders/orders.service.ts:143 canCancel이 응답에서 빠진다',
      '- FINDING 확인 질문 `./web/src/pages/OrderPage.tsx:72-77` 버튼이 사라진다',
      `FINDING 고치면 좋음 ${ROOT}/contracts/openapi.yaml:365 계약을 고치지 않았다`,
    ].join('\n')
    assert.deepEqual(parseFindings(text, { root: ROOT }), {
      declared: true,
      findings: [
        { level: '고쳐야 함', path: 'server/src/orders/orders.service.ts', line: 143, endLine: 143, summary: 'canCancel이 응답에서 빠진다' },
        { level: '확인 질문', path: 'web/src/pages/OrderPage.tsx', line: 72, endLine: 77, summary: '버튼이 사라진다' },
        { level: '고치면 좋음', path: 'contracts/openapi.yaml', line: 365, endLine: 365, summary: '계약을 고치지 않았다' },
      ],
    })
  })

  it('FINDING 줄이 없으면 내장 /code-review의 JSON 지적 목록(file·line·summary)을 읽는다 — 단계는 없다', () => {
    const text = ['I found 2 problems.', '```json', JSON.stringify([{ file: 'server/src/orders/orders.service.ts', line: 143, summary: 'canCancel is gone', failure_scenario: '...' }, { file: `${ROOT}/web/src/a.ts`, line: 3, summary: 'x' }]), '```'].join('\n')
    assert.deepEqual(parseFindings(text, { root: ROOT }), {
      declared: true,
      findings: [
        { level: null, path: 'server/src/orders/orders.service.ts', line: 143, endLine: 143, summary: 'canCancel is gone' },
        { level: null, path: 'web/src/a.ts', line: 3, endLine: 3, summary: 'x' },
      ],
    })
    // FINDING 줄이 있으면 그것만 읽는다
    assert.equal(parseFindings(`FINDING 없음\n${text}`, { root: ROOT }).findings.length, 0)
  })

  it('JSON 목록 앞에 다른 코드 블록이 있어도 블록을 짝지어 읽는다', () => {
    const text = ['고치는 법:', '', '```ts', 'const kst = new Date(t + OFFSET)', '```', '', '나머지는 작다.', '', '```json', JSON.stringify([{ file: 'server/src/orders/returns-policy.ts', line: 14, summary: 'UTC 날짜' }]), '```'].join('\n')
    assert.deepEqual(parseFindings(text, { root: ROOT }).findings.map((f) => `${f.path}:${f.line}`), ['server/src/orders/returns-policy.ts:14'])
  })

  it('"FINDING 없음"이면 지적 없음, FINDING 줄이 하나도 없으면 형식을 지키지 않은 것이다', () => {
    assert.deepEqual(parseFindings('문제 없어 보입니다.\nFINDING 없음\n', { root: ROOT }), { declared: true, findings: [] })
    assert.deepEqual(parseFindings('문제 없어 보입니다.', { root: ROOT }), { declared: false, findings: [] })
  })
})

describe('matchFindings — 정답과 맞추기', () => {
  it('같은 파일에서 정답 줄(범위) ±3 안이면 찾은 것이다 — 근거 위치(사용처)에서 지적해도 찾은 것이다', () => {
    const at = (path, line) => ({ level: '고쳐야 함', path, line, endLine: line, summary: '' })
    assert.equal(matchFindings({ findings: [at('server/src/orders/orders.service.ts', 146)], answers: defect().findings }).matched.length, 1)
    assert.equal(matchFindings({ findings: [at('server/src/orders/orders.service.ts', 147)], answers: defect().findings }).matched.length, 0)
    assert.equal(matchFindings({ findings: [at('web/src/pages/OrderPage.tsx', 72)], answers: defect().findings }).matched.length, 1)
    assert.equal(matchFindings({ findings: [at('web/src/pages/CartPage.tsx', 143)], answers: defect().findings }).matched.length, 0)
  })

  it('정답 하나에 지적이 여럿이면 하나만 센다. 정답 밖의 지적은 따로 센다', () => {
    const findings = [
      { level: '고쳐야 함', path: 'server/src/orders/orders.service.ts', line: 143, endLine: 143, summary: 'a' },
      { level: '확인 질문', path: 'web/src/pages/OrderPage.tsx', line: 72, endLine: 72, summary: 'b' },
      { level: '고치면 좋음', path: 'server/src/money.ts', line: 3, endLine: 3, summary: 'c' },
    ]
    const result = matchFindings({ findings, answers: defect().findings })
    assert.equal(result.matched.length, 1)
    assert.deepEqual(result.missed, [])
    assert.deepEqual(result.extra.map((f) => f.summary), ['c'])
  })
})

describe('coverageOf — 정답의 근거가 맥락 묶음에 있는가(모델 없이)', () => {
  const bundle = {
    files: [{ newPath: 'server/src/orders/orders.service.ts', hunks: [{ newStart: 143, newLines: 1 }] }],
    impact: { symbols: [{ usages: [{ path: 'server/src/orders/orders.controller.ts', line: 11 }] }], contracts: [{ changes: [{ usages: [{ path: 'web/src/pages/OrderPage.tsx', line: 72 }] }] }] },
    history: { commits: { abc: { subject: 'fix: 새벽에 받은 주문의 반품 기한이 하루 짧던 문제' } } },
  }

  it('위치는 바뀐 조각(±3)·바뀐 파일(조각 밖)·영향 범위의 사용처(±3)에 있으면, 커밋은 이력에 있으면 있다', () => {
    const result = coverageOf({ bundle, defect: defect() })
    assert.deepEqual(
      result.map((item) => [item.what, item.covered, item.where]),
      [
        ['server/src/orders/orders.service.ts:143', true, '바뀐 조각'],
        ['contracts/openapi.yaml:365', false, null],
        ['web/src/pages/OrderPage.tsx:72', true, '영향 범위'],
      ],
    )
    // 바뀐 파일의 조각 밖 — 리뷰어가 바뀐 파일을 열면 보이는 곳
    const sameFile = coverageOf({ bundle, defect: defect({ findings: [{ ...defect().findings[0], evidence: [{ path: 'server/src/orders/orders.service.ts', line: 54 }] }] }) })
    assert.deepEqual(sameFile.at(-1), { answer: 0, kind: 'location', what: 'server/src/orders/orders.service.ts:54', covered: true, where: '바뀐 파일' })
    const history = coverageOf({ bundle, defect: defect({ findings: [{ ...defect().findings[0], evidence: [{ commit: 'fix: 새벽에 받은 주문' }] }] }) })
    assert.deepEqual(history.at(-1), { answer: 0, kind: 'commit', what: 'fix: 새벽에 받은 주문', covered: true, where: '이력' })
    // 근거가 이슈면 — 묶음의 의도에 그 이슈의 본문이 있으면 있다
    const withIssue = { ...bundle, intent: { issues: [{ number: 41, title: '메뉴 정렬', body: '품절 상품은 맨 아래로' }], unreadIssues: [42] } }
    const issues = coverageOf({ bundle: withIssue, defect: defect({ findings: [{ ...defect().findings[0], evidence: [{ issue: 41 }, { issue: 42 }] }] }) })
    assert.deepEqual(issues.slice(-2), [
      { answer: 0, kind: 'issue', what: '#41', covered: true, where: '의도' },
      { answer: 0, kind: 'issue', what: '#42', covered: false, where: null },
    ])
  })
})

describe('scoreRuns — 리뷰어마다 집계', () => {
  const runs = [
    { reviewer: 'gimi', id: 'COM-024', run: 1, defect: defect(), output: 'FINDING 고쳐야 함 web/src/pages/OrderPage.tsx:72 버튼이 사라진다\nFINDING 고치면 좋음 server/src/money.ts:3 이름' },
    { reviewer: 'gimi', id: 'COM-024', run: 2, defect: defect(), output: 'FINDING 없음' },
    { reviewer: 'code-review', id: 'COM-024', run: 1, defect: defect(), output: '형식 없는 리뷰' },
    { reviewer: 'gimi', id: 'CLEAN-001', run: 1, defect: { id: 'CLEAN-001', clean: true, findings: [] }, output: 'FINDING 확인 질문 web/src/a.ts:1 x\nFINDING 고쳐야 함 web/src/a.ts:2 y' },
  ]
  // COM-024는 근거 하나(openapi.yaml)가 묶음에 없다 — 놓치면 수집 실패
  const coverage = { 'COM-024': [{ answer: 0, kind: 'location', what: 'contracts/openapi.yaml:365', covered: false, where: null }] }

  it('찾은 비율은 결함 PR 실행마다의 정답 기준, 놓친 것은 수집 실패·판단 실패로 나누고, 결함 없는 PR의 지적은 오탐이다', () => {
    const { reviewers } = scoreRuns({ runs, coverage })
    const gimi = reviewers.find((r) => r.name === 'gimi')
    assert.deepEqual(
      { runs: gimi.runs, answers: gimi.answers, found: gimi.found, collectMiss: gimi.collectMiss, judgeMiss: gimi.judgeMiss, extra: gimi.extra, falsePositives: gimi.falsePositives, blockingFalsePositives: gimi.blockingFalsePositives, noFormat: gimi.noFormat },
      { runs: 3, answers: 2, found: 1, collectMiss: 1, judgeMiss: 0, extra: 1, falsePositives: 2, blockingFalsePositives: 1, noFormat: 0 },
    )
    const baseline = reviewers.find((r) => r.name === 'code-review')
    assert.deepEqual([baseline.answers, baseline.found, baseline.noFormat], [1, 0, 1])
  })

  it('단계가 없는 지적(JSON 목록)이 결함 없는 PR에 있으면 "고쳐야 함" 오탐 수는 셀 수 없다', () => {
    const json = '```json\n[{"file":"web/src/a.ts","line":1,"summary":"x"}]\n```'
    const { reviewers } = scoreRuns({ runs: [{ reviewer: 'code-review', id: 'CLEAN-001', run: 1, defect: { id: 'CLEAN-001', clean: true, findings: [] }, output: json }] })
    assert.deepEqual([reviewers[0].falsePositives, reviewers[0].blockingFalsePositives], [1, null])
    assert.match(formatScore(scoreRuns({ runs: [{ reviewer: 'code-review', id: 'CLEAN-001', run: 1, defect: { id: 'CLEAN-001', clean: true, findings: [] }, output: json }] })), /\| 1 \(고쳐야 함 -\) \|/)
  })

  it('formatScore — 리뷰어마다 한 줄, 결함마다 한 줄', () => {
    const text = formatScore(scoreRuns({ runs, coverage }))
    assert.match(text, /\| gimi \| 3 \| 1\/2 \(50%\) \| 1 \| 0 \| 1 \| 2 \(고쳐야 함 1\) \| 0 \|/)
    // 수집·판단 실패는 맥락 묶음을 쓰는 gimi에만 나눈다
    assert.match(text, /\| code-review \| 1 \| 0\/1 \(0%\) \| - \| - \| 0 \| 0 \(고쳐야 함 0\) \| 1 \|/)
    assert.match(text, /\| COM-024 \| 영향 범위 \| gimi 1\/2 · code-review 0\/1 \|/)
  })
})

describe('hunksOf·locateFinding — 지적이 PR diff의 어디에 있나', () => {
  const patch = [
    'diff --git a/web/src/cart.ts b/web/src/cart.ts',
    '--- a/web/src/cart.ts',
    '+++ b/web/src/cart.ts',
    '@@ -10,2 +10,3 @@ export const total = () => {',
    ' a',
    '+b',
    ' c',
    'diff --git a/web/src/new.ts b/web/src/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/web/src/new.ts',
    '@@ -0,0 +1,4 @@',
    '+x',
    'diff --git a/web/src/gone.ts b/web/src/gone.ts',
    'deleted file mode 100644',
    '--- a/web/src/gone.ts',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-y',
  ].join('\n')

  it('새 줄 범위를 파일마다 읽는다 — 지운 파일은 뺀다', () => {
    assert.deepEqual(hunksOf(patch), [
      { path: 'web/src/cart.ts', from: 10, to: 12 },
      { path: 'web/src/new.ts', from: 1, to: 4 },
    ])
  })

  it('바뀐 조각(±3)·바뀐 파일의 조각 밖·바뀌지 않은 파일로 나눈다', () => {
    const hunks = hunksOf(patch)
    const at = (path, line) => locateFinding({ finding: { path, line, endLine: line }, hunks })
    assert.deepEqual([at('web/src/cart.ts', 15), at('web/src/cart.ts', 16), at('web/src/cart.ts', 40), at('web/src/other.ts', 1)], ['hunk', 'file', 'file', 'outside'])
  })

  it('scoreRuns·formatScore — 실행에 diff 조각이 있으면 정답 밖 지적과 오탐을 위치로 나눠 센다', () => {
    const hunks = hunksOf(patch)
    const runs = [
      { reviewer: 'gimi', id: 'COM-024', run: 1, hunks, defect: defect(), output: 'FINDING 고쳐야 함 server/src/orders/orders.service.ts:143 a\nFINDING 고치면 좋음 web/src/cart.ts:11 b\nFINDING 고치면 좋음 web/src/other.ts:2 c' },
      { reviewer: 'gimi', id: 'CLEAN-001', run: 1, hunks, defect: { id: 'CLEAN-001', clean: true, findings: [] }, output: 'FINDING 확인 질문 web/src/cart.ts:40 d' },
    ]
    const gimi = scoreRuns({ runs }).reviewers[0]
    assert.deepEqual([gimi.extraAt, gimi.falseAt], [{ hunk: 1, file: 0, outside: 1 }, { hunk: 0, file: 1, outside: 0 }])
    assert.match(formatScore(scoreRuns({ runs })), /\| gimi \| 2 — 1 · 0 · 1 \| 1 — 0 · 1 · 0 \|/)
    // diff 조각이 없는 실행이 섞이면 나누지 않는다
    assert.equal(scoreRuns({ runs: [{ ...runs[0], hunks: undefined }] }).reviewers[0].extraAt, null)
  })
})
