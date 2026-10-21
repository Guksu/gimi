import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { compareExports, extractExportsText, extractExportsTs } from '../skills/gimi-review/scripts/lib/exports.mjs'

const source = `import { x } from './x'

export function getStatus(id: string): string {
  return id
}

export const LABEL = '주문'
export const toWon = (n: number): number => {
  return Math.round(n)
}
export type Status = 'PAID' | 'READY'
export interface Order {
  id: string
}
export class Cart {
  add(id: string): void {
    console.log(id)
  }
}
export { helper, other as renamed } from './helper'
export default function Page() {
  return null
}
const internal = 1
`

describe('extractExportsTs', () => {
  const exports = extractExportsTs({ ts, text: source, fileName: 'src/order.tsx' })
  const byName = new Map(exports.map((e) => [e.name, e]))

  it('최상위 export 선언의 이름을 모두 찾고, export하지 않은 선언은 뺀다', () => {
    assert.deepEqual([...byName.keys()], ['getStatus', 'LABEL', 'toWon', 'Status', 'Order', 'Cart', 'helper', 'renamed', 'default'])
  })

  it('선언의 줄 범위를 1부터 센다', () => {
    assert.deepEqual([byName.get('getStatus').start, byName.get('getStatus').end], [3, 5])
    assert.deepEqual([byName.get('Cart').start, byName.get('Cart').end], [15, 19])
  })

  it('함수의 시그니처는 본문을 뺀 머리다', () => {
    assert.equal(byName.get('getStatus').signature, 'export function getStatus(id: string): string')
    assert.equal(byName.get('toWon').signature, 'export const toWon = (n: number): number =>')
  })

  it('클래스의 시그니처는 머리와 멤버의 본문 없는 선언이다', () => {
    assert.equal(byName.get('Cart').signature, 'export class Cart { add(id: string): void }')
  })

  it('타입·인터페이스·상수는 선언 전체가 시그니처다', () => {
    assert.equal(byName.get('Status').signature, "export type Status = 'PAID' | 'READY'")
    assert.equal(byName.get('LABEL').signature, "export const LABEL = '주문'")
  })

  it('참조 찾기에 쓸 이름 위치를 담는다', () => {
    const e = byName.get('getStatus')
    assert.equal(source.slice(e.namePos, e.namePos + 'getStatus'.length), 'getStatus')
    assert.equal(byName.get('helper').namePos, null)
  })
})

describe('extractExportsText', () => {
  it('TypeScript가 없을 때 줄 단위로 export를 찾는다', () => {
    const names = extractExportsText({ text: source }).map((e) => e.name)
    assert.deepEqual(names, ['getStatus', 'LABEL', 'toWon', 'Status', 'Order', 'Cart', 'helper', 'renamed', 'default'])
  })

  it('다음 export 전까지를 그 선언의 범위로 보고, 첫 줄을 시그니처로 쓴다', () => {
    const e = extractExportsText({ text: source }).find((x) => x.name === 'getStatus')
    assert.deepEqual([e.start, e.end, e.signature], [3, 6, 'export function getStatus(id: string): string {'])
  })
})

describe('compareExports', () => {
  const ex = (name, start, end, signature) => ({ name, kind: 'function', start, end, signature, namePos: 0 })

  it('추가·삭제·시그니처 변경·본문만 변경을 나누고, 바뀌지 않은 export는 뺀다', () => {
    const before = [ex('getStatus', 1, 3, 'a'), ex('legacy', 4, 6, 'b'), ex('stable', 7, 9, 'c'), ex('same', 10, 12, 'd')]
    const after = [ex('getStatus', 1, 3, 'a2'), ex('stable', 4, 6, 'c'), ex('same', 7, 9, 'd'), ex('fresh', 10, 11, 'e')]
    const changes = compareExports({ before, after, removedLines: new Set([5, 8]), addedLines: new Set([5, 10, 11]) })
    assert.deepEqual(
      changes.map((c) => [c.name, c.change]),
      [
        ['getStatus', 'signature'],
        ['stable', 'body'],
        ['fresh', 'added'],
        ['legacy', 'removed'],
      ],
    )
  })
})
