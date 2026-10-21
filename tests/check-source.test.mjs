import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readSource } from '../skills/gimi-test/scripts/lib/source.mjs'

describe('readSource — 주석·문자열 가리기', () => {
  it('문자열·주석의 내용을 공백으로 가리되 길이와 줄 바꿈은 그대로 둔다', () => {
    const text = `const a = 'it.only(' // expect(x)\nconst b = "x" /* debugger */ + 1\n`
    const source = readSource(text)
    assert.equal(source.masked.length, text.length)
    assert.equal(source.masked.split('\n').length, text.split('\n').length)
    assert.doesNotMatch(source.masked, /only|expect|debugger/)
    assert.match(source.masked, /const a = ' {8}'/)
  })

  it('템플릿 문자열은 글자만 가리고 ${} 안의 코드는 남긴다 — 중첩도 따라간다', () => {
    const source = readSource('const s = `a ${fn(`b ${c}`)} d`\n')
    assert.match(source.masked, /fn\(/)
    assert.match(source.masked, /\{c\}/)
    assert.doesNotMatch(source.masked, /a \$|b \$| d`/)
  })

  it('정규식 리터럴은 가리고, 나눗셈은 코드로 둔다', () => {
    const source = readSource('const r = /expect\\(/g\nconst n = total / count / 2\n')
    assert.doesNotMatch(source.masked, /expect/)
    assert.match(source.masked, /total \/ count \/ 2/)
  })

  it('JSX 닫는 태그(</p>)와 스스로 닫는 태그(/>)를 정규식으로 읽지 않는다', () => {
    const source = readSource('const el = <li key={i}>{x}</li>\nconst y = <Item a={1} />\nexpect(z)\n')
    assert.match(source.masked, /<\/li>/)
    assert.match(source.masked, /expect\(z\)/)
  })

  it('닫지 않은 따옴표는 그 줄에서 끝낸다 — JSX 글자(Don\'t)가 파일 끝까지 가리지 않게', () => {
    const source = readSource("const el = <p>Don't</p>\nexpect(a).toBe(1)\n")
    assert.match(source.masked, /expect\(a\)\.toBe\(1\)/)
  })

  it('주석은 줄 번호·종류·자기 줄에만 있는지와 함께 모은다', () => {
    const source = readSource('// 위 주석\nfoo() // 뒤 주석\n/* 여러\n줄 */\n')
    assert.deepEqual(
      source.comments.map((c) => [c.line, c.kind, c.ownLine, c.text]),
      [
        [1, 'line', true, ' 위 주석'],
        [2, 'line', false, ' 뒤 주석'],
        [3, 'block', true, ' 여러\n줄 '],
      ],
    )
  })

  it('문자열은 시작 위치와 값으로 모은다 — vi.mock의 경로를 읽는 데 쓴다', () => {
    const text = "vi.mock('./cart')\n"
    const source = readSource(text)
    assert.deepEqual(source.strings.map((s) => [s.value, text[s.start]]), [['./cart', "'"]])
  })
})

describe('readSource — 괄호 짝과 줄 번호', () => {
  it('여는 괄호의 위치로 닫는 괄호를 찾는다 — 문자열 안의 괄호는 세지 않는다', () => {
    const text = "it('a)', () => { expect(f(1)).toBe(')') })"
    const source = readSource(text)
    const open = text.indexOf('(')
    assert.equal(source.close(open), text.length - 1)
    const brace = text.indexOf('{')
    assert.equal(text[source.close(brace)], '}')
  })

  it('위치를 1부터 세는 줄 번호로 바꾼다', () => {
    const source = readSource('a\nbb\nccc\n')
    assert.deepEqual([source.lineOf(0), source.lineOf(2), source.lineOf(5), source.lineOf(7)], [1, 2, 3, 3])
  })

  it('줄 번호로 원래 줄을 돌려준다', () => {
    assert.equal(readSource('a\n  bb\n').lineText(2), '  bb')
  })
})
