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
  impact: null,
  skipped: [{ context: '영향 범위', reason: '아직 구현 전' }],
  notes: [],
})

describe('renderSummary', () => {
  it('범위·바뀐 파일·의도·이력·건너뜀·전체 경로를 차례로 보인다', () => {
    const text = renderSummary({ context: context(), outPath: 'docs/gimi/reviews/x.context.json' })
    const order = ['범위', '바뀐 파일', '의도', '이력', '건너뜀', '전체'].map((label) => text.indexOf(label))
    assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), text)
    assert.match(text, /main\.\.\.feat\/SHOP-9-status/)
    assert.match(text, /M src\/order\.ts {2}\+3 −1/)
    assert.match(text, /A src\/badge\.ts/)
    assert.match(text, /PR #42 "주문 상태 표시"/)
    assert.match(text, /이슈 #38 "배지 색"/)
    assert.match(text, /SHOP-9\(jira — 에이전트가 읽음\)/)
    assert.match(text, /영향 범위 — 아직 구현 전/)
    assert.match(text, /docs\/gimi\/reviews\/x\.context\.json/)
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
