import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { YamlUnsupported, parseYaml } from '../skills/gimi-review/scripts/lib/yaml.mjs'

describe('parseYaml — OpenAPI에 흔한 YAML', () => {
  it('들여쓰기 맵·목록·숫자·참거짓·null을 읽는다 — 숫자 키(응답 코드)는 문자열 키다', () => {
    const doc = parseYaml(['openapi: 3.0.3', 'info:', '  title: Shop', '  version: 1.0.0', 'paths:', '  /orders/{id}:', '    get:', '      responses:', '        200:', '          description: ok', '        "404":', '          description: none', 'flags:', '  a: true', '  b: null', '  c: ~', '  n: 12', '  f: 1.5'].join('\n'))
    assert.deepEqual(doc, {
      openapi: '3.0.3',
      info: { title: 'Shop', version: '1.0.0' },
      paths: { '/orders/{id}': { get: { responses: { 200: { description: 'ok' }, 404: { description: 'none' } } } } },
      flags: { a: true, b: null, c: null, n: 12, f: 1.5 },
    })
  })

  it('목록 안의 맵(- name: …)과 키와 같은 들여쓰기의 목록을 읽는다', () => {
    const doc = parseYaml(['parameters:', '  - name: id', '    in: path', '    required: true', '  - name: q', '    in: query', 'required:', '- id', '- totalAmount'].join('\n'))
    assert.deepEqual(doc, { parameters: [{ name: 'id', in: 'path', required: true }, { name: 'q', in: 'query' }], required: ['id', 'totalAmount'] })
  })

  it('따옴표 문자열·흐름 목록과 맵·주석을 읽는다', () => {
    const doc = parseYaml(["a: 'it''s'", 'b: "line\\nnext \\"q\\""', 'c: [id, "total amount", 3]', 'd: {type: string, format: uuid}', 'e: []', 'f: {}', 'g: value # 주석', '# 줄 주석', "h: '#은 따옴표 안에서 글자다'", 'url: http://example.com/a#b'].join('\n'))
    assert.deepEqual(doc, { a: "it's", b: 'line\nnext "q"', c: ['id', 'total amount', 3], d: { type: 'string', format: 'uuid' }, e: [], f: {}, g: 'value', h: '#은 따옴표 안에서 글자다', url: 'http://example.com/a#b' })
  })

  it('블록 문자열(|·>)과 여러 줄 평문을 읽는다', () => {
    const doc = parseYaml(['literal: |', '  첫 줄', '  둘째 줄', 'folded: >-', '  접힌', '  문장', 'plain: 긴 설명이', '  다음 줄로 이어진다', 'next: 1'].join('\n'))
    assert.deepEqual(doc, { literal: '첫 줄\n둘째 줄\n', folded: '접힌 문장', plain: '긴 설명이 다음 줄로 이어진다', next: 1 })
  })

  it('앵커·별칭·태그·탭 들여쓰기는 지원하지 않는다고 알린다(틀리게 읽지 않는다)', () => {
    for (const text of ['a: &x 1\nb: *x', 'a: !!str 1', 'a:\n\tb: 1']) assert.throws(() => parseYaml(text), YamlUnsupported)
  })
})
