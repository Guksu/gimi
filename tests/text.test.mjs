import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { oneLine, safeLine } from '../skills/gimi-review/scripts/lib/text.mjs'

describe('oneLine·safeLine — PR이 정할 수 있는 글을 요약의 한 줄로', () => {
  it('줄을 나누는 문자·제어 문자·글 방향 문자를 빈칸으로 바꾼다 — safeLine은 앞뒤 빈칸을 그대로 둔다', () => {
    assert.equal(safeLine('  a\nb\r\u0085c\u2028d\u202ee  '), '  a b c d e  ')
  })

  it('oneLine은 앞뒤 빈칸을 없애고 max 글자로 자른다 — 없는 값은 빈 글', () => {
    assert.equal(oneLine('  가\n나  '), '가 나')
    assert.equal(oneLine('abcdef', 3), 'abc…')
    assert.equal(oneLine('abc', 3), 'abc')
    assert.equal(oneLine(null), '')
    assert.equal(oneLine(undefined), '')
    assert.equal(oneLine('x'.repeat(130)).length, 121)
  })
})
