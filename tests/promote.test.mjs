import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseReviewRecord, readBundleNames, tallyBundles } from '../skills/gimi-review/scripts/lib/promote.mjs'

const finding = (n, { level = '고쳐야 함', rule, verdict } = {}) =>
  [`## ${n}. [${level}] 영향 범위 — 지적 ${n}`, '- 바뀐 곳: `src/a.ts:1`', rule === undefined ? null : `- 규칙: ${rule}`, verdict === undefined ? null : `- 판정: ${verdict}`].filter((line) => line !== null).join('\n')
const record = (...findings) => ['# 리뷰 — PR #42', '', '- 날짜: 2026-11-04', '', ...findings.flatMap((text) => [text, ''])].join('\n')

describe('parseReviewRecord — 리뷰 기록의 지적마다 규칙·묶음·판정', () => {
  it('"## N. [단계] …" 절마다 규칙 ID나 묶음 이름과 판정을 읽는다 — 판정이 없으면 미정', () => {
    const text = record(finding(1, { rule: 'COM-003', verdict: '맞음' }), finding(2, { rule: '없음 — 묶음 api-shape-consumer' }), finding(3, { level: '확인 질문', rule: '없음 - 묶음 `Null-Guard`', verdict: '틀림 — 의도한 동작' }))
    assert.deepEqual(parseReviewRecord(text), [
      { index: 1, level: '고쳐야 함', rule: 'COM-003', bundle: null, verdict: '맞음', problem: null },
      { index: 2, level: '고쳐야 함', rule: null, bundle: 'api-shape-consumer', verdict: '미정', problem: null },
      { index: 3, level: '확인 질문', rule: null, bundle: 'null-guard', verdict: '틀림', problem: null },
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

  it('같은 리뷰 기록의 같은 묶음은 한 번으로 세고, 판정이 틀림·의도함인 지적은 세지 않는다', () => {
    const result = tallyBundles({ records, known: new Map(), threshold: 3 })
    const api = result.bundles.find((b) => b.name === 'api-shape')
    assert.equal(api.reviews, 3)
    assert.equal(api.status, 'reached')
    assert.deepEqual(api.sources, [{ path: 'docs/gimi/reviews/a.md', findings: [1, 2] }, { path: 'docs/gimi/reviews/b.md', findings: [1] }, { path: 'docs/gimi/reviews/c.md', findings: [1] }])
    const guard = result.bundles.find((b) => b.name === 'null-guard')
    assert.deepEqual([guard.reviews, guard.status], [1, 'growing'])
    assert.deepEqual(result.findings, { counted: 6, excluded: 1 })
    assert.deepEqual(result.malformed, [{ path: 'docs/gimi/reviews/c.md', finding: 3, problem: '규칙 줄 없음' }])
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
