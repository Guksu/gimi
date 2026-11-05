import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseReviewRecord, readBundleNames, reviewKey, tallyBundles } from '../skills/gimi-review/scripts/lib/promote.mjs'

const finding = (n, { level = '고쳐야 함', rule, verdict } = {}) =>
  [`## ${n}. [${level}] 영향 범위 — 지적 ${n}`, '- 바뀐 곳: `src/a.ts:1`', rule === undefined ? null : `- 규칙: ${rule}`, verdict === undefined ? null : `- 판정: ${verdict}`].filter((line) => line !== null).join('\n')
const record = (...findings) => ['# 리뷰 — PR #42', '', '- 날짜: 2026-11-04', '', ...findings.flatMap((text) => [text, ''])].join('\n')

describe('parseReviewRecord — 리뷰 기록의 지적마다 규칙·묶음·판정', () => {
  it('"## N. [단계] …" 절마다 규칙 ID나 묶음 이름과 판정을 읽는다 — 판정이 없으면 미정', () => {
    const text = record(finding(1, { rule: 'COM-003', verdict: '맞음' }), finding(2, { rule: '없음 — 묶음 api-shape-consumer' }), finding(3, { level: '확인 질문', rule: '없음 - 묶음 `Null-Guard`', verdict: '틀림 — 의도한 동작' }))
    assert.deepEqual(parseReviewRecord(text), [
      { index: 1, line: 5, level: '고쳐야 함', rule: 'COM-003', bundle: null, verdict: '맞음', problem: null },
      { index: 2, line: 10, level: '고쳐야 함', rule: null, bundle: 'api-shape-consumer', verdict: '미정', problem: null },
      { index: 3, line: 14, level: '확인 질문', rule: null, bundle: 'null-guard', verdict: '틀림', problem: null },
    ])
  })

  it('규칙 줄이 없거나, 없음인데 묶음 이름이 없거나 틀리면 형식 어김으로 남긴다. 지적이 아닌 절(확인한 것 등)은 읽지 않는다', () => {
    const text = record(finding(1), finding(2, { rule: '없음' }), finding(3, { rule: '없음 — 묶음 한글 이름' }), '## 확인한 것\n- 규칙: 없음 — 묶음 not-a-finding')
    assert.deepEqual(
      parseReviewRecord(text).map((f) => [f.index, f.problem]),
      [
        [1, '규칙 줄 없음'],
        [2, '묶음 이름이 없거나 형식이 틀림'],
        [3, '묶음 이름이 없거나 형식이 틀림'],
      ],
    )
  })
})

describe('parseReviewRecord — 결정 64의 지적 형식(바뀐 코드·생긴 때)', () => {
  it('맥락 종류 "바뀐 코드"와 "- 생긴 때:" 줄이 든 지적도 규칙·묶음·판정을 그대로 읽는다', () => {
    const text = [
      '# 리뷰 — feature-pr',
      '',
      '## 1. [고쳐야 함] 바뀐 코드 — 다시 담으면 수량이 1로 돌아간다',
      '- 바뀐 곳: `web/src/cart/cart.tsx:51`',
      '- 근거: `web/src/cart/cart.tsx:51` — quantity: 1',
      '- 상황: 2개 담긴 상품을 다시 담으면 1개',
      '- 생긴 때: 이번 변경',
      '- 규칙: 없음 — 묶음 cart-quantity-reset',
      '- 판정: 미정',
      '',
      '## 2. [고치면 좋음] 영향 범위 — 변경 전부터 빈 목록 안내가 없다',
      '- 생긴 때: 변경 전부터',
      '- 규칙: 없음 — 묶음 empty-state',
      '- 판정: 맞음',
      '',
    ].join('\n')
    assert.deepEqual(
      parseReviewRecord(text).map(({ index, level, bundle, verdict, problem }) => ({ index, level, bundle, verdict, problem })),
      [
        { index: 1, level: '고쳐야 함', bundle: 'cart-quantity-reset', verdict: '미정', problem: null },
        { index: 2, level: '고치면 좋음', bundle: 'empty-state', verdict: '맞음', problem: null },
      ],
    )
  })
})

describe('parseReviewRecord — 에이전트가 형식을 조금 다르게 쓴 기록', () => {
  it('단계 표시([고쳐야 함] 등)가 있는데 "## N. [단계]" 꼴이 아닌 머리는 조용히 빼지 않고 형식 어김으로 남긴다', () => {
    const text = ['## 1. [고쳐야 함] 영향 범위 — 맞는 꼴', '- 규칙: 없음 — 묶음 a', '### 2. [고쳐야 함] 영향 범위 — 셋째 단계 머리', '- 판정: 틀림', '## [고치면 좋음] 번호 없음', '**[확인 질문]** 굵은 글', '1) [고쳐야 함] 괄호 번호', '## 확인한 것'].join('\n')
    assert.deepEqual(
      parseReviewRecord(text).map((f) => [f.index, f.line, f.level, f.verdict, f.problem]),
      [
        [1, 1, '고쳐야 함', '미정', null],
        [null, 3, '고쳐야 함', '미정', '지적 머리 형식 어김'],
        [null, 5, '고치면 좋음', '미정', '지적 머리 형식 어김'],
        [null, 6, '확인 질문', '미정', '지적 머리 형식 어김'],
        [null, 7, '고쳐야 함', '미정', '지적 머리 형식 어김'],
      ],
    )
  })

  it('규칙·판정 줄의 굵은 글·백틱을 읽고, 없음·묶음이 든 값은 묶음으로만 읽는다 — 모르는 판정은 형식 어김, 판정은 첫 줄만', () => {
    const text = record(
      finding(1, { rule: '**없음** — 묶음 `api-shape`', verdict: '**틀림** — 의도한 동작' }),
      '## 2. [고쳐야 함] 영향 범위 — b\n- **규칙**: 없음 — 묶음 null-guard\n- **판정**: 의도함',
      finding(3, { rule: '`없음`' }),
      finding(4, { rule: '해당 없음' }),
      finding(5, { rule: '없음 — 묶음 c', verdict: '오탐' }),
      '## 6. [고쳐야 함] 영향 범위 — f\n- 규칙: 없음 — 묶음 d\n- 판정: 맞음\n- 판정: 틀림',
    )
    assert.deepEqual(
      parseReviewRecord(text).map((f) => [f.index, f.bundle, f.verdict, f.problem]),
      [
        [1, 'api-shape', '틀림', null],
        [2, 'null-guard', '의도함', null],
        [3, null, '미정', '묶음 이름이 없거나 형식이 틀림'],
        [4, null, '미정', '묶음 이름이 없거나 형식이 틀림'],
        [5, 'c', '미정', '판정을 모름(미정·맞음·틀림·의도함)'],
        [6, 'd', '맞음', null],
      ],
    )
  })

  it('코드 블록 안의 줄은 읽지 않는다 — 인용한 머리·규칙 줄로 지적을 만들거나 지적을 끊지 않는다. CRLF도 읽는다', () => {
    const text = ['## 1. [고쳐야 함] 영향 범위 — a', '- 근거:', '```ts', '# 주석', '## 2. [고쳐야 함] 인용 — injected', '- 규칙: 없음 — 묶음 injected', '```', '- 규칙: 없음 — 묶음 real', ''].join('\r\n')
    assert.deepEqual(parseReviewRecord(text).map((f) => [f.index, f.bundle, f.problem]), [[1, 'real', null]])
  })
})

describe('reviewKey — 같은 PR·브랜치의 기록은 날짜가 달라도 한 리뷰다', () => {
  it('파일 이름에서 날짜 머리와 .md를 뗀다', () => {
    assert.equal(reviewKey('docs/gimi/reviews/2026-11-01-pr-42.md'), 'pr-42')
    assert.equal(reviewKey('docs/gimi/reviews/2026-11-02-feat-order-status.md'), 'feat-order-status')
    assert.equal(reviewKey('docs/gimi/reviews/notes.md'), 'notes')
  })
})

describe('readBundleNames — 후보·회사 규칙 파일의 "- 묶음:" 줄', () => {
  it('이미 후보로 올렸거나 규칙이 된 묶음 이름을 모은다', () => {
    const text = '# 규칙 후보\n\n## SHOP-007 주문 상태는 한 곳에서만 바꾼다\n- 상태: 거절 — 화면마다 다르다\n- 묶음: Order-Transition\n\n## SHOP-008 x\n- 묶음: `api-shape-consumer`\n'
    assert.deepEqual(readBundleNames(text), ['order-transition', 'api-shape-consumer'])
    assert.deepEqual(readBundleNames(null), [])
  })
})

describe('tallyBundles — 묶음마다 리뷰 건수', () => {
  const records = [
    { path: 'docs/gimi/reviews/a.md', findings: parseReviewRecord(record(finding(1, { rule: '없음 — 묶음 api-shape' }), finding(2, { rule: '없음 — 묶음 api-shape' }), finding(3, { rule: '없음 — 묶음 null-guard' }))) },
    { path: 'docs/gimi/reviews/b.md', findings: parseReviewRecord(record(finding(1, { rule: '없음 — 묶음 api-shape' }), finding(2, { rule: '없음 — 묶음 null-guard', verdict: '의도함' }))) },
    { path: 'docs/gimi/reviews/c.md', findings: parseReviewRecord(record(finding(1, { rule: '없음 — 묶음 api-shape', verdict: '맞음' }), finding(2, { rule: '없음 — 묶음 old-rule' }), finding(3))) },
  ]

  it('같은 PR을 다른 날 다시 리뷰한 기록은 한 리뷰로 센다 — 출처에는 기록마다 남긴다', () => {
    const again = [1, 2].map((day) => ({ path: `docs/gimi/reviews/2026-11-0${day}-pr-42.md`, findings: parseReviewRecord(record(finding(1, { rule: '없음 — 묶음 api-shape' }))) }))
    const other = { path: 'docs/gimi/reviews/2026-11-03-pr-43.md', findings: parseReviewRecord(record(finding(1, { rule: '없음 — 묶음 api-shape' }))) }
    const [api] = tallyBundles({ records: [...again, other], known: new Map(), threshold: 3 }).bundles
    assert.deepEqual([api.reviews, api.status, api.sources.length], [2, 'growing', 3])
  })

  it('같은 리뷰 기록의 같은 묶음은 한 번으로 세고, 판정이 틀림·의도함인 지적은 세지 않는다', () => {
    const result = tallyBundles({ records, known: new Map(), threshold: 3 })
    const api = result.bundles.find((b) => b.name === 'api-shape')
    assert.equal(api.reviews, 3)
    assert.equal(api.status, 'reached')
    assert.deepEqual(api.sources, [{ path: 'docs/gimi/reviews/a.md', findings: [1, 2] }, { path: 'docs/gimi/reviews/b.md', findings: [1] }, { path: 'docs/gimi/reviews/c.md', findings: [1] }])
    const guard = result.bundles.find((b) => b.name === 'null-guard')
    assert.deepEqual([guard.reviews, guard.status], [1, 'growing'])
    assert.deepEqual(result.findings, { counted: 6, excluded: 1 })
    assert.deepEqual(result.malformed, [{ path: 'docs/gimi/reviews/c.md', finding: 3, line: 14, problem: '규칙 줄 없음' }])
  })

  it('이미 후보·규칙인 묶음은 기준에 닿아도 다시 올리지 않는다. 기준에 닿은 것부터, 건수가 많은 것부터, 이름 순서로', () => {
    const result = tallyBundles({ records, known: new Map([['api-shape', 'docs/gimi/candidates.md']]), threshold: 1 })
    assert.deepEqual(
      result.bundles.map((b) => [b.name, b.status, b.where]),
      [
        ['null-guard', 'reached', null],
        ['old-rule', 'reached', null],
        ['api-shape', 'known', 'docs/gimi/candidates.md'],
      ],
    )
  })
})
