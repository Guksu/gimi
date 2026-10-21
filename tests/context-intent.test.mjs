import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractTicketRefs, intentTexts } from '../skills/gimi-review/scripts/lib/intent.mjs'

describe('intentTexts', () => {
  it('브랜치·PR 제목·본문·커밋 제목·본문을 모으되, 커밋 제목 끝의 스쿼시 PR 번호 "(#36)"는 뗀다', () => {
    const texts = intentTexts({
      branch: 'feat/SHOP-9',
      prInfo: { title: '주문 상태', body: 'closes #38' },
      commits: [{ subject: 'feat: 위시 라벨 (#36)', body: 'refs #40' }],
    })
    assert.deepEqual(texts, ['feat/SHOP-9', '주문 상태', 'closes #38', 'feat: 위시 라벨', 'refs #40'])
    assert.deepEqual(extractTicketRefs({ texts }).issueNumbers, [38, 40])
  })
})

describe('extractTicketRefs', () => {
  it('브랜치 이름·커밋에서 티켓 번호를 뽑고, 흔한 표준 이름(UTF-8 등)은 빼고, 겹치면 하나로 둔다', () => {
    const { tickets } = extractTicketRefs({ texts: ['feat/SHOP-123-cart', 'fix: 품절 차단 (SHOP-124)', 'SHOP-123 다시', 'UTF-8 인코딩, ISO-4217 통화, SHA-256'] })
    assert.deepEqual(tickets, [
      { id: 'SHOP-123', source: 'unknown' },
      { id: 'SHOP-124', source: 'unknown' },
    ])
  })

  it('설정의 번호 형식과 맞으면 그 출처를 붙인다', () => {
    const { tickets } = extractTicketRefs({ texts: ['SHOP-9 그리고 ENG-4'], keyPatterns: [{ source: 'jira', pattern: 'SHOP-\\d+' }] })
    assert.deepEqual(tickets, [
      { id: 'SHOP-9', source: 'jira' },
      { id: 'ENG-4', source: 'unknown' },
    ])
  })

  it('#번호 참조를 이슈 후보로 모은다 — HTML 엔티티·단어 안의 #은 아니다', () => {
    const { issueNumbers } = extractTicketRefs({ texts: ['closes #38 and #40', '(#40) 다시', 'a&#39;b', 'abc#5'] })
    assert.deepEqual(issueNumbers, [38, 40])
  })

  it('Jira·Notion·Linear·Confluence 링크만 모아 출처를 붙인다', () => {
    const { links } = extractTicketRefs({
      texts: [
        '기획 https://shop.atlassian.net/browse/SHOP-1 과 https://www.notion.so/spec-abc 참고',
        'https://linear.app/team/issue/ENG-4 그리고 https://github.com/a/b/pull/1',
      ],
    })
    assert.deepEqual(links, [
      { url: 'https://shop.atlassian.net/browse/SHOP-1', source: 'jira' },
      { url: 'https://www.notion.so/spec-abc', source: 'notion' },
      { url: 'https://linear.app/team/issue/ENG-4', source: 'linear' },
    ])
  })

  it('비어 있거나 없는 글은 건너뛴다', () => {
    assert.deepEqual(extractTicketRefs({ texts: [null, '', undefined] }), { tickets: [], issueNumbers: [], links: [] })
  })
})
