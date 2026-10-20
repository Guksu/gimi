import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bodyOf, fieldOf, frontmatterOf } from '../scripts/lib/frontmatter.mjs'

const md = '---\nname: gimi-review\ndescription: 코드 리뷰를 한다\n---\n\n# 본문\n'

describe('frontmatterOf', () => {
  it('첫 --- 사이의 내용을 돌려준다', () => {
    assert.equal(frontmatterOf(md), 'name: gimi-review\ndescription: 코드 리뷰를 한다')
  })

  it('frontmatter가 없으면 null이다', () => {
    assert.equal(frontmatterOf('# 제목만\n'), null)
  })

  it('CRLF 줄바꿈도 읽는다', () => {
    assert.equal(frontmatterOf(md.replaceAll('\n', '\r\n')), 'name: gimi-review\ndescription: 코드 리뷰를 한다')
  })
})

describe('fieldOf', () => {
  it('한 줄 값을 돌려준다', () => {
    assert.equal(fieldOf({ frontmatter: frontmatterOf(md), key: 'name' }), 'gimi-review')
  })

  it('따옴표로 감싼 값은 따옴표를 뗀다', () => {
    assert.equal(fieldOf({ frontmatter: 'description: "따옴표 값"', key: 'description' }), '따옴표 값')
  })

  it('없는 키나 frontmatter가 없으면 빈 문자열이다', () => {
    assert.equal(fieldOf({ frontmatter: frontmatterOf(md), key: 'license' }), '')
    assert.equal(fieldOf({ frontmatter: null, key: 'name' }), '')
  })
})

describe('bodyOf', () => {
  it('frontmatter 다음의 본문을 돌려준다', () => {
    assert.equal(bodyOf(md), '\n# 본문\n')
  })

  it('frontmatter가 없으면 전체가 본문이다', () => {
    assert.equal(bodyOf('# 제목\n'), '# 제목\n')
  })
})
