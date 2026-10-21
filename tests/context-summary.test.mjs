import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderSummary } from '../skills/gimi-review/scripts/lib/summary.mjs'

const sha = (c) => c.repeat(40)
const commit = (c, subject, extra = {}) => ({ sha: sha(c), short: sha(c).slice(0, 7), subject, body: '', date: '', tags: [], formatting: false, prRefs: [], ...extra })

const context = () => ({
  version: 1,
  scope: { baseRef: 'main', branch: 'feat/SHOP-9-status', head: sha('f'), mergeBase: sha('e'), commitCount: 2, dirty: false, pr: { number: 42, url: 'https://github.com/a/b/pull/42' } },
  files: [
    { oldPath: 'src/order.ts', newPath: 'src/order.ts', status: 'modified', binary: false, additions: 3, deletions: 1, hunks: [] },
    { oldPath: null, newPath: 'src/badge.ts', status: 'added', binary: false, additions: 10, deletions: 0, hunks: [] },
  ],
  intent: {
    branch: 'feat/SHOP-9-status',
    pr: { number: 42, title: '주문 상태 표시', body: '', url: '' },
    commits: [{ sha: sha('1') }, { sha: sha('2') }],
    tickets: [{ id: 'SHOP-9', source: 'jira' }],
    links: [],
    issueNumbers: [38],
    issues: [{ number: 38, title: '배지 색', body: '', url: '' }],
    unreadIssues: [],
  },
  history: {
    recentCommits: 10,
    files: [{ path: 'src/order.ts', newPath: 'src/order.ts', status: 'modified', changedOldLines: 4, blamed: [{ sha: sha('a'), lines: [3] }, { sha: sha('b'), lines: [4] }], recent: [sha('a'), sha('b'), sha('c'), sha('d')] }],
    commits: {
      [sha('a')]: commit('a', 'feat: 처음'),
      [sha('b')]: commit('b', 'fix: iOS 스크롤 복원', { tags: ['fix'] }),
      [sha('c')]: commit('c', 'style: prettier 적용', { formatting: true }),
      [sha('d')]: commit('d', 'Revert "feat: 빠른 담기"', { tags: ['revert'] }),
    },
    notes: [],
  },
  impact: {
    method: 'typescript',
    reason: null,
    symbols: [
      { name: 'stable', kind: 'function', change: 'body', path: 'src/order.ts', method: 'typescript', searched: true, total: 0, unchanged: 0, usages: [] },
      {
        name: 'getStatus',
        kind: 'function',
        change: 'signature',
        path: 'src/order.ts',
        method: 'typescript',
        searched: true,
        total: 2,
        unchanged: 1,
        usages: [
          { path: 'src/badge.ts', line: 2, text: '', context: [], changedInPr: false },
          { path: 'src/list.ts', line: 2, text: '', context: [], changedInPr: true },
        ],
      },
      { name: 'legacy', kind: 'function', change: 'removed', path: 'src/order.ts', method: 'text', searched: true, total: 1, unchanged: 1, usages: [{ path: 'src/legacy-user.ts', line: 2, text: '', context: [], changedInPr: false }] },
      { name: 'default', kind: 'default', change: 'body', path: 'src/page.tsx', method: 'text', searched: false, total: 0, unchanged: 0, usages: [] },
    ],
    added: [{ name: 'fresh', path: 'src/order.ts' }],
    literals: [{ value: 'orders/list', path: 'src/keys.ts', total: 1, unchanged: 1, usages: [{ path: 'src/cache.ts', line: 1, text: '', context: [], changedInPr: false }] }],
    notes: [],
  },
  skipped: [{ context: '의도', reason: 'gh 없음' }],
  notes: [],
})

describe('renderSummary', () => {
  it('범위·바뀐 파일·의도·이력·영향 범위·건너뜀·전체 경로를 차례로 보인다', () => {
    const text = renderSummary({ context: context(), outPath: 'docs/gimi/reviews/x.context.json' })
    const order = ['범위', '바뀐 파일', '의도', '이력', '영향 범위', '건너뜀', '전체'].map((label) => text.indexOf(label))
    assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), text)
    assert.match(text, /main\.\.\.feat\/SHOP-9-status/)
    assert.match(text, /M src\/order\.ts {2}\+3 −1/)
    assert.match(text, /A src\/badge\.ts/)
    assert.match(text, /PR #42 "주문 상태 표시"/)
    assert.match(text, /이슈 #38 "배지 색"/)
    assert.match(text, /SHOP-9\(jira — 에이전트가 읽음\)/)
    assert.match(text, /docs\/gimi\/reviews\/x\.context\.json/)
  })

  it('영향 범위 머리에 바뀐 export·바뀐 문자열·새 export 수와, 심볼마다 실제로 쓴 방법의 수를 쓴다', () => {
    const text = renderSummary({ context: context(), outPath: 'x.json' })
    assert.match(text, /^영향 범위 {2}바뀐 export 4개\(TypeScript 참조 2 · 문자열 검색 2\) \/ 바뀐 문자열 1개 \/ 새 export 1개$/m)
  })

  it('TypeScript를 불러왔어도 모든 심볼을 문자열로 찾았으면(tsconfig 없음) 머리에 문자열 검색이라고 쓴다', () => {
    const ctx = context()
    ctx.impact.symbols = ctx.impact.symbols.map((s) => ({ ...s, method: 'text' }))
    assert.match(renderSummary({ context: ctx, outPath: 'x.json' }), /^영향 범위 {2}바뀐 export 4개\(문자열 검색\)/m)
  })

  it('시그니처 변경·삭제를 본문만 변경보다 먼저 보이고, diff 밖(이 변경에서 안 바뀐) 사용처만 줄로 보이고 바뀐 곳은 수로 묶는다', () => {
    const text = renderSummary({ context: context(), outPath: 'x.json' })
    assert.match(text, /^ {2}getStatus \(시그니처 변경\) — src\/order\.ts {2}사용처 2\(이 변경에서 안 바뀜 1\)$/m)
    assert.match(text, /^ {4}src\/badge\.ts:2$/m)
    assert.doesNotMatch(text, /src\/list\.ts:2/)
    assert.match(text, /^ {4}이 변경에서 함께 바뀐 곳 1곳 — diff에서 본다$/m)
    assert.match(text, /^ {2}legacy \(삭제\) — src\/order\.ts {2}사용처 1\(이 변경에서 안 바뀜 1 · 문자열 검색\)$/m)
    assert.match(text, /^ {2}stable \(본문만 변경\) — src\/order\.ts {2}사용처 없음$/m)
    assert.ok(text.indexOf('legacy (삭제)') < text.indexOf('stable (본문만 변경)'), text)
  })

  it('이름 없는 default export는 사용처를 찾지 않았다고 쓰고, 바뀐 문자열과 그 사용처를 보인다', () => {
    const text = renderSummary({ context: context(), outPath: 'x.json' })
    assert.match(text, /^ {2}default \(본문만 변경\) — src\/page\.tsx {2}사용처를 찾지 않음\(이름 없는 default export\)$/m)
    assert.match(text, /^ {2}"orders\/list" \(바뀐 문자열\) — src\/keys\.ts {2}사용처 1\(이 변경에서 안 바뀜 1\)$/m)
    assert.match(text, /^ {4}src\/cache\.ts:1$/m)
  })

  it('안 바뀐 사용처는 10곳까지만 보이고 나머지 수를 적는다', () => {
    const ctx = context()
    const usages = Array.from({ length: 25 }, (_, i) => ({ path: `src/u${i}.ts`, line: 1, text: '', context: [], changedInPr: false }))
    ctx.impact.symbols = [{ name: 'formatPrice', kind: 'function', change: 'signature', path: 'src/price.ts', method: 'typescript', searched: true, total: 40, unchanged: 40, usages }]
    const text = renderSummary({ context: ctx, outPath: 'x.json' })
    assert.match(text, /^ {4}… 안 바뀐 곳 30곳 더 — JSON에 있다$/m)
  })

  it('문자열 검색으로 내려갔으면 이유와 정확도를 참고로 적는다', () => {
    const ctx = context()
    ctx.impact.method = 'text'
    ctx.impact.reason = '이 프로젝트에 typescript가 없다'
    const text = renderSummary({ context: ctx, outPath: 'x.json' })
    assert.match(text, /^영향 범위 {2}바뀐 export 4개\(문자열 검색\)/m)
    assert.match(text, /^참고 {4}영향 범위는 문자열 검색으로 찾았다\(정확도 낮음\) — 이 프로젝트에 typescript가 없다$/m)
  })

  it('바뀐 줄을 넣은 커밋은 수정·되돌리기 표시가 있는 것부터 보이고, 서식 정리 커밋은 뺀다', () => {
    const text = renderSummary({ context: context(), outPath: 'x.json' })
    assert.ok(text.indexOf('bbbbbbb fix: iOS 스크롤 복원 [수정]') < text.indexOf('aaaaaaa feat: 처음'), text)
    assert.match(text, /ddddddd Revert "feat: 빠른 담기" \[되돌리기\]/)
    assert.doesNotMatch(text, /prettier/)
  })

  it('이력을 건너뛰었으면(null) 이력 줄 대신 건너뜀에 남은 이유만 보인다', () => {
    const ctx = context()
    ctx.history = null
    ctx.skipped.push({ context: '이력', reason: '얕은 복제' })
    const text = renderSummary({ context: ctx, outPath: 'x.json' })
    assert.doesNotMatch(text, /^이력 /m)
    assert.match(text, /이력 — 얕은 복제/)
  })

  it('의도가 비어 있으면 "없음"이라고 쓴다', () => {
    const ctx = context()
    ctx.intent = { ...ctx.intent, pr: null, tickets: [], issues: [], issueNumbers: [], links: [] }
    assert.match(renderSummary({ context: ctx, outPath: 'x.json' }), /의도 {4}없음/)
  })

  it('줄 수 상한을 넘으면 중간을 줄이고 마지막 줄(전체 경로)은 남긴다', () => {
    const ctx = context()
    ctx.files = Array.from({ length: 40 }, (_, i) => ({ oldPath: `f${i}.ts`, newPath: `f${i}.ts`, status: 'modified', binary: false, additions: 1, deletions: 1, hunks: [] }))
    const text = renderSummary({ context: ctx, outPath: 'x.json', maxLines: 20 })
    const rows = text.trimEnd().split('\n')
    assert.equal(rows.length, 20)
    assert.match(rows.at(-2), /… 외 \d+줄/)
    assert.match(rows.at(-1), /^전체/)
  })
})
