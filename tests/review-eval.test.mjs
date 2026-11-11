import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { JUDGMENTS, coverageOf, formatScore, hunksOf, judgmentItems, locateFinding, matchFindings, mergeJudgments, parseFindings, scoreRuns, tallyJudgments } from '../scripts/lib/review-eval.mjs'

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
    // 근거가 지난 리뷰 기록이면 — 묶음의 prior가 그 파일을 읽었으면 있다(설계 결정 72). 다른 기록 파일은 없다
    const withPrior = { ...bundle, prior: { path: 'docs/gimi/reviews/2026-11-01-feature-pr.md', findings: [{ index: 1 }] } }
    const prior = coverageOf({ bundle: withPrior, defect: defect({ findings: [{ ...defect().findings[0], evidence: [{ path: 'docs/gimi/reviews/2026-11-01-feature-pr.md', line: 15 }, { path: 'docs/gimi/reviews/2026-10-01-feature-pr.md', line: 3 }] }] }) })
    assert.deepEqual(prior.slice(-2), [
      { answer: 0, kind: 'location', what: 'docs/gimi/reviews/2026-11-01-feature-pr.md:15', covered: true, where: '지난 리뷰' },
      { answer: 0, kind: 'location', what: 'docs/gimi/reviews/2026-10-01-feature-pr.md:3', covered: false, where: null },
    ])
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

describe('설정 조건 — 실행마다 평가용 저장소의 설정(.agents/gimi.json)과 규칙 목록 첫 줄', () => {
  const header = '규칙      stacks frontend-ts·backend (설정 없음 — 프론트·백엔드 신호를 못 찾아 둘 다) · 프리셋 없음 · 회사 규칙 없음'
  const base = { id: 'COM-024', defect: defect(), output: 'FINDING 없음' }

  it('리뷰어마다 같은 조건끼리 묶는다 — 설정이 없으면 없음, 이 기록이 생기기 전의 결과는 기록 없음, 규칙 목록을 못 돌렸으면 읽지 못함', () => {
    const runs = [
      { ...base, reviewer: 'gimi', run: 1, config: null, rules: header },
      { ...base, reviewer: 'gimi', run: 2, config: null, rules: header },
      { ...base, reviewer: 'gimi', run: 3, config: { presets: ['commerce'] }, rules: null },
      { ...base, reviewer: 'code-review', run: 1 },
    ]
    const { reviewers, mixed } = scoreRuns({ runs })
    assert.deepEqual(
      reviewers.map((r) => [r.name, r.conditions]),
      [
        ['gimi', [{ config: '없음', rules: header.replace(/^규칙\s+/, ''), runs: 2 }, { config: '{"presets":["commerce"]}', rules: '읽지 못함', runs: 1 }]],
        ['code-review', [{ config: '기록 없음', rules: '기록 없음', runs: 1 }]],
      ],
    )
    assert.equal(mixed, true)
  })

  it('formatScore — 채점표 위에 설정 조건 표를 두고, 조건이 다른 실행이 섞이면 알린다', () => {
    const text = formatScore(scoreRuns({ runs: [{ ...base, reviewer: 'gimi', run: 1, config: { stacks: ['backend'] }, rules: header }, { ...base, reviewer: 'code-review', run: 1, config: null, rules: header }] }))
    const lines = text.split('\n')
    // 규칙 목록은 gimi만 읽는다 — code-review 줄의 값은 같은 평가용 저장소에서 gimi가 볼 목록이다
    assert.equal(lines[0], '| 리뷰어 | 실행 | 설정(.agents/gimi.json) | gimi의 규칙 목록 첫 줄 |')
    assert.ok(lines.includes('| gimi | 1 | `{"stacks":["backend"]}` | stacks frontend-ts·backend (설정 없음 — 프론트·백엔드 신호를 못 찾아 둘 다) · 프리셋 없음 · 회사 규칙 없음 |'), text)
    assert.ok(lines.includes('| code-review | 1 | 없음 | stacks frontend-ts·backend (설정 없음 — 프론트·백엔드 신호를 못 찾아 둘 다) · 프리셋 없음 · 회사 규칙 없음 |'), text)
    assert.ok(lines.includes('실행마다 설정 조건이 다르다 — 결과 문서에 어느 실행이 어떤 조건인지 적는다.'), text)
    assert.ok(lines.indexOf('| 리뷰어 | 실행 | 찾음 | 수집 실패 | 판단 실패 | 정답 밖 지적 | 오탐(결함 없는 PR) | 형식 어김 |') > 0)
  })

  it('조건이 모두 같으면 알리지 않는다 — 표를 깨는 |는 이스케이프한다', () => {
    const runs = ['gimi', 'code-review'].map((reviewer) => ({ ...base, reviewer, run: 1, config: { note: 'a|b' }, rules: header }))
    const text = formatScore(scoreRuns({ runs }))
    assert.equal(scoreRuns({ runs }).mixed, false)
    assert.doesNotMatch(text, /설정 조건이 다르다/)
    assert.ok(text.includes('| gimi | 1 | `{"note":"a\\|b"}` |'), text)
  })

  it('설정에 백틱이 있으면 더 긴 백틱으로 감싼다 — 코드 표시가 깨지지 않게', () => {
    const text = formatScore(scoreRuns({ runs: [{ ...base, reviewer: 'gimi', run: 1, config: { note: 'a`b' }, rules: header }] }))
    assert.ok(text.includes('| gimi | 1 | `` {"note":"a`b"} `` |'), text)
  })
})

describe('실행 조건 — 모델·gimi 판·도구(설계 결정 65)', () => {
  const tools = { allowed: ['Read', 'Bash'], disallowed: ['Bash(npm *)'] }
  const base = { id: 'COM-024', defect: defect(), output: 'FINDING 없음', config: null, rules: '규칙 x' }
  const runs = [
    { ...base, reviewer: 'gimi', run: 1, runs: 2, model: 'claude-opus-5-5', gimi: { version: '0.2.0', commit: 'abcdef1234567', dirty: false }, tools },
    { ...base, reviewer: 'gimi', run: 2, runs: 2, model: 'claude-opus-5-5', gimi: { version: '0.2.0', commit: 'abcdef1234567', dirty: true }, tools },
    { ...base, reviewer: 'code-review', run: 1, runs: 1, model: 'claude-opus-5-5', gimi: null, tools },
    { ...base, reviewer: 'code-review', run: 2 },
  ]

  it('gimi 판을 읽지 못한 실행은 안 씀이 아니라 읽지 못함이다', () => {
    const { reviewers } = scoreRuns({ runs: [{ ...base, reviewer: 'gimi', run: 1, runs: 1, model: 'm', gimi: { error: 'git 없음' }, tools }] })
    assert.equal(reviewers[0].setups[0].gimi, '읽지 못함(git 없음)')
  })

  it('리뷰어마다 모델·gimi 판(커밋)·도구·반복 횟수가 같은 실행끼리 묶는다 — gimi를 쓰지 않은 리뷰어는 안 씀, 이 기록이 생기기 전의 결과는 기록 없음', () => {
    const { reviewers } = scoreRuns({ runs })
    assert.deepEqual(
      reviewers.map((r) => [r.name, r.setups]),
      [
        [
          'gimi',
          [
            { model: 'claude-opus-5-5', gimi: '0.2.0 (abcdef1)', tools: 'Read·Bash / 막음 Bash(npm *)', repeat: '2', runs: 1 },
            { model: 'claude-opus-5-5', gimi: '0.2.0 (abcdef1, 커밋하지 않은 수정 있음)', tools: 'Read·Bash / 막음 Bash(npm *)', repeat: '2', runs: 1 },
          ],
        ],
        [
          'code-review',
          [
            { model: 'claude-opus-5-5', gimi: '안 씀', tools: 'Read·Bash / 막음 Bash(npm *)', repeat: '1', runs: 1 },
            { model: '기록 없음', gimi: '기록 없음', tools: '기록 없음', repeat: '기록 없음', runs: 1 },
          ],
        ],
      ],
    )
  })

  it('formatScore — 설정 조건 표 다음에 실행 조건 표를 둔다', () => {
    const text = formatScore(scoreRuns({ runs }))
    const lines = text.split('\n')
    const at = lines.indexOf('| 리뷰어 | 실행 | 모델 | gimi 판 | 도구(허용 / 막음) | 결함마다 반복 |')
    assert.ok(at > lines.indexOf('| 리뷰어 | 실행 | 설정(.agents/gimi.json) | gimi의 규칙 목록 첫 줄 |'), text)
    assert.ok(lines.includes('| gimi | 1 | claude-opus-5-5 | 0.2.0 (abcdef1) | Read·Bash / 막음 Bash(npm *) | 2 |'), text)
    assert.ok(lines.includes('| code-review | 1 | 기록 없음 | 기록 없음 | 기록 없음 | 기록 없음 |'), text)
  })
})

describe('수동 판정 — 위치 점수와 의미 판정을 나눈다(설계 결정 65)', () => {
  const runs = [
    { reviewer: 'gimi', id: 'COM-024', run: 1, defect: defect(), output: 'FINDING 고쳐야 함 web/src/pages/OrderPage.tsx:72 버튼이 사라진다\nFINDING 고치면 좋음 server/src/money.ts:3 이름\nFINDING 고치면 좋음 server/src/money.ts:3 이름 두 번째' },
    { reviewer: 'gimi', id: 'COM-024', run: 2, defect: defect(), output: 'FINDING 없음' },
    { reviewer: 'gimi', id: 'CLEAN-001', run: 1, defect: { id: 'CLEAN-001', clean: true, findings: [] }, output: 'FINDING 확인 질문 web/src/a.ts:1 x' },
  ]
  const items = () => judgmentItems(scoreRuns({ runs }).runs)

  it('judgmentItems — 위치로 찾은 정답·놓친 정답·정답 밖 지적·결함 없는 PR의 지적마다 항목 하나, 처음은 모두 미검토', () => {
    const list = items()
    assert.deepEqual(
      list.map((item) => [item.key, item.kind, item.judgment]),
      [
        ['gimi/COM-024#1/정답 1', 'found', '미검토'],
        ['gimi/COM-024#1/지적 server/src/money.ts:3', 'extra', '미검토'],
        ['gimi/COM-024#1/지적 server/src/money.ts:3 (2)', 'extra', '미검토'],
        ['gimi/COM-024#2/정답 1', 'missed', '미검토'],
        ['gimi/CLEAN-001#1/지적 web/src/a.ts:1', 'false', '미검토'],
      ],
    )
    // 판정하는 사람이 견줄 것 — 정답의 설명과 리뷰어의 지적, 단계가 정답과 같은지
    assert.equal(list[0].answer, 'canCancel이 빠진다')
    assert.equal(list[0].finding, '고쳐야 함 web/src/pages/OrderPage.tsx:72 버튼이 사라진다')
    assert.equal(list[0].sameLevel, true)
    assert.equal(list[3].finding, null)
  })

  it('mergeJudgments — 저장된 판정과 메모는 지키고 새 항목은 미검토로 더한다. 종류에 없는 값은 미검토로 두고, 없는 항목의 판정은 알린다', () => {
    const saved = {
      items: [
        { key: 'gimi/COM-024#1/정답 1', judgment: '일치', note: '원인·실패 조건이 같다' },
        { key: 'gimi/COM-024#1/지적 server/src/money.ts:3', judgment: '맞음' },
        { key: 'gimi/COM-024#2/정답 1', judgment: '못 찾음' },
        { key: 'gimi/OLD-001#1/정답 1', judgment: '일치' },
      ],
    }
    const { items: merged, problems } = mergeJudgments({ items: items(), saved })
    assert.deepEqual([merged[0].judgment, merged[0].note], ['일치', '원인·실패 조건이 같다'])
    assert.equal(merged[1].judgment, '미검토')
    assert.equal(merged[3].judgment, '못 찾음')
    assert.ok(problems.some((p) => /money\.ts:3.*맞음/.test(p)), problems.join(' / '))
    assert.ok(problems.some((p) => /OLD-001#1.*채점 결과에 없다/.test(p)), problems.join(' / '))
  })

  it('mergeJudgments — 채점 결과에 없는 항목과 지적이 바뀐 항목의 판정은 버리지 않고 orphans로 남긴다', () => {
    const list = items()
    const saved = {
      items: [
        { key: 'gimi/COM-024#1/정답 1', finding: '고쳐야 함 web/src/pages/OrderPage.tsx:70 다른 지적', judgment: '일치', note: '예전 지적' },
        { key: 'gimi/OLD-001#1/정답 1', finding: 'x', judgment: '일치', note: '옛 실행' },
      ],
      orphans: [{ key: 'gimi/OLDER#1/정답 1', judgment: '불일치', reason: '전에 남김' }],
    }
    const { items: merged, orphans, problems } = mergeJudgments({ items: list, saved })
    // 위치로 맞은 지적이 바뀌었다 — 예전 판정을 새 지적에 옮겨 붙이지 않는다
    assert.equal(merged[0].judgment, '미검토')
    assert.deepEqual(
      orphans.map((o) => [o.key, o.judgment, o.reason]),
      [
        ['gimi/OLDER#1/정답 1', '불일치', '전에 남김'],
        ['gimi/COM-024#1/정답 1', '일치', '판정한 지적과 지금 지적이 다르다'],
        ['gimi/OLD-001#1/정답 1', '일치', '채점 결과에 없다'],
      ],
    )
    assert.ok(problems.some((p) => /COM-024#1\/정답 1.*지적이 다르다/.test(p)), problems.join(' / '))
  })

  it('judgmentItems — 키가 겹치면(같은 리뷰어의 실행이 두 폴더에) 실패한다', () => {
    const twice = scoreRuns({ runs: [runs[1], { ...runs[1] }] }).runs
    assert.throws(() => judgmentItems(twice), /키가 겹친다.*gimi\/COM-024#2/)
  })

  it('정답 밖 지적은 "정답과 같은 결함"으로도 판정한다 — 놓친 정답의 다른 위치 지적을 두 번 세지 않는다', () => {
    assert.ok(JUDGMENTS.extra.includes('정답과 같은 결함'))
    assert.ok(!JUDGMENTS.false.includes('정답과 같은 결함'))
  })

  it('tallyJudgments·formatScore — 의미 판정은 위치 점수와 따로 보이고, 사람이 보지 않은 것은 미검토로 센다', () => {
    const saved = { items: [{ key: 'gimi/COM-024#1/정답 1', judgment: '일치' }, { key: 'gimi/COM-024#1/지적 server/src/money.ts:3', judgment: '잘못된 지적' }] }
    const judged = tallyJudgments(mergeJudgments({ items: items(), saved }).items)
    const text = formatScore({ ...scoreRuns({ runs }), judged })
    assert.ok(text.includes('| 리뷰어 | 위치로 찾은 정답 — 원인·실패 조건 일치 · 불일치 · 미검토 | 위치로 놓친 정답 — 다른 위치에서 찾음 · 못 찾음 · 미검토 | 정답 밖 지적 — 실제 결함 · 잘못된 지적 · 판단 보류 · 정답과 같은 결함 · 미검토 | 결함 없는 PR의 지적 — 실제 결함 · 잘못된 지적 · 판단 보류 · 미검토 |'), text)
    assert.ok(text.includes('| gimi | 1 — 1 · 0 · 0 | 1 — 0 · 0 · 1 | 2 — 0 · 1 · 0 · 0 · 1 | 1 — 0 · 0 · 0 · 1 |'), text)
    assert.match(text, /사람이 판정한 것\(judgments\.json\)/)
    assert.doesNotMatch(formatScore(scoreRuns({ runs })), /위치로 놓친 정답/)
  })
})

describe('정답의 출처 — 실행 때 남긴 정답과 지금 결함 정의', () => {
  it('실행 기록에 정답이 없으면(answersFrom 지금) 그 수를 세고, 채점표에 줄이 어긋날 수 있다고 알린다', () => {
    const runs = [
      { reviewer: 'gimi', id: 'COM-024', run: 1, defect: defect(), answersFrom: '실행 때', output: 'FINDING 없음' },
      { reviewer: 'gimi', id: 'COM-024', run: 2, defect: defect(), answersFrom: '지금', output: 'FINDING 없음' },
    ]
    const result = scoreRuns({ runs })
    assert.equal(result.currentAnswers, 1)
    assert.match(formatScore(result), /실행 때의 정답이 기록에 없는 실행 1개는 지금 결함 정의로 맞췄다/)
    assert.doesNotMatch(formatScore(scoreRuns({ runs: [runs[0]] })), /지금 결함 정의로 맞췄다/)
  })
})
