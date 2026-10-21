import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { changedLiterals, keyLiteralsOf } from '../skills/gimi-review/scripts/lib/literals.mjs'

describe('keyLiteralsOf', () => {
  it('키처럼 생긴 문자열(쿼리 키·라우트·i18n 키·저장소 키)을 뽑는다', () => {
    assert.deepEqual(keyLiteralsOf("useQuery({ queryKey: ['orders/list', id] })"), ['orders/list'])
    assert.deepEqual(keyLiteralsOf("fetch('/api/orders/' + id)"), ['/api/orders/'])
    assert.deepEqual(keyLiteralsOf('t("cart.empty.title")'), ['cart.empty.title'])
    assert.deepEqual(keyLiteralsOf("localStorage.getItem('gimi:cart')"), ['gimi:cart'])
  })

  it('import 경로·공백이 있는 문구·변수가 든 템플릿·버전 번호·너무 짧은 것은 뺀다', () => {
    assert.deepEqual(keyLiteralsOf("import { x } from './order.ts'"), [])
    assert.deepEqual(keyLiteralsOf("const y = require('node:fs')"), [])
    assert.deepEqual(keyLiteralsOf("toast('장바구니에 담았어요 :)')"), [])
    assert.deepEqual(keyLiteralsOf('fetch(`/api/orders/${id}`)'), [])
    assert.deepEqual(keyLiteralsOf("const v = '1.2.3'"), [])
    assert.deepEqual(keyLiteralsOf("const s = 'a.b'"), [])
  })

  it('특수 문자가 없는 낱말은 소음이 커서 뽑지 않는다', () => {
    assert.deepEqual(keyLiteralsOf("queryKey: ['orders', 'list']"), [])
  })
})

describe('changedLiterals', () => {
  it('지운 줄에만 있고 더한 줄에는 없는 문자열 — 바뀌거나 사라진 키만 돌려준다', () => {
    const file = {
      hunks: [
        {
          removed: [{ line: 3, text: "queryKey: ['orders/list']" }, { line: 4, text: "t('cart.title')" }],
          added: [{ line: 3, text: "queryKey: ['orders/all']" }, { line: 4, text: "t('cart.title')" }],
        },
      ],
    }
    assert.deepEqual(changedLiterals(file), ['orders/list'])
  })
})
