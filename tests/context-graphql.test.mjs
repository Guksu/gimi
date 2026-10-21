import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { GraphqlError, diffSchema, extractDocuments, parseSchema, resolveOperations } from '../skills/gimi-review/scripts/lib/graphql.mjs'

const SCHEMA = `
"""주문 API"""
schema { query: Query mutation: Mutation }

type Query {
  "주문 하나"
  order(id: ID!): Order
  orders(status: OrderStatus, first: Int = 20): [Order!]!
  search(q: String!): [SearchResult!]!
}

type Mutation {
  placeOrder(input: PlaceOrderInput!): Order! @deprecated(reason: "v2")
}

type Order implements Node {
  id: ID!
  totalAmount: Int!
  status: OrderStatus!
  items: [OrderItem!]!
}

type OrderItem { sku: String! qty: Int! }
interface Node { id: ID! }
union SearchResult = Order | OrderItem
enum OrderStatus { PAID SHIPPED CANCELLED }
input PlaceOrderInput { items: [ItemInput!]! coupon: String }
input ItemInput { sku: String! qty: Int! }
scalar DateTime
directive @auth(role: String) on FIELD_DEFINITION
`
const sdl = (text) => parseSchema([{ path: 'schema.graphql', text }])
const keyed = (changes) => Object.fromEntries(changes.map((c) => [c.key, c]))

describe('parseSchema', () => {
  it('타입·필드(인자·타입)·enum·union·input과 루트 타입을 읽는다 — 설명·지시어는 넘긴다', () => {
    const schema = sdl(SCHEMA)
    assert.deepEqual(schema.roots, { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' })
    assert.equal(schema.types.get('Query').fields.get('orders').type, '[Order!]!')
    assert.deepEqual([...schema.types.get('Query').fields.get('orders').args], [['status', 'OrderStatus'], ['first', 'Int']])
    assert.deepEqual([...schema.types.get('OrderStatus').values], ['PAID', 'SHIPPED', 'CANCELLED'])
    assert.deepEqual([...schema.types.get('SearchResult').members], ['Order', 'OrderItem'])
    assert.equal(schema.types.get('ItemInput').kind, 'input')
    assert.equal(schema.types.get('Order').fields.get('totalAmount').line, 18)
  })

  it('extend type은 같은 타입에 필드를 더하고, 여러 파일을 합친다', () => {
    const schema = parseSchema([
      { path: 'a.graphql', text: 'type Query { a: Int }' },
      { path: 'b.graphql', text: 'extend type Query { b: String }' },
    ])
    assert.deepEqual([...schema.types.get('Query').fields.keys()], ['a', 'b'])
    assert.equal(schema.types.get('Query').fields.get('b').path, 'b.graphql')
  })

  it('문법이 틀리면 줄 번호와 함께 GraphqlError를 던진다', () => {
    assert.throws(() => sdl('type Query {\n  a: \n}'), (error) => error instanceof GraphqlError && /3번째 줄/.test(error.message))
  })
})

describe('diffSchema', () => {
  const after = (edit) => sdl(edit(SCHEMA))

  it('필드를 지우면 깨질 수 있음이고, 사용처를 찾을 대상은 그 필드다', () => {
    const changes = keyed(diffSchema({ before: sdl(SCHEMA), after: after((s) => s.replace('  totalAmount: Int!\n', '')) }))
    const change = changes['Order.totalAmount']
    assert.deepEqual([change.change, change.level, change.details], ['removed', 'breaking', ['필드를 지웠다']])
    assert.deepEqual(change.affects, ['Order.totalAmount'])
  })

  it('출력 필드의 null 허용은 확인, null 금지는 추가, 다른 타입은 깨질 수 있음이다', () => {
    const changes = keyed(diffSchema({ before: sdl(SCHEMA), after: after((s) => s.replace('totalAmount: Int!', 'totalAmount: Int').replace('qty: Int! }', 'qty: Int!, note: String }').replace('sku: String! qty', 'sku: ID! qty')) }))
    assert.deepEqual([changes['Order.totalAmount'].level, changes['Order.totalAmount'].details], ['caution', ['타입 Int! → Int(null을 허용하게 됐다)']])
    assert.equal(changes['OrderItem.sku'].level, 'breaking')
    assert.deepEqual([changes['OrderItem.note'].change, changes['OrderItem.note'].level], ['added', 'additive'])
  })

  it('필수 인자를 더하면 깨질 수 있음, 선택 인자는 추가다 — 바뀐 것은 그 필드에 모은다', () => {
    const change = keyed(diffSchema({ before: sdl(SCHEMA), after: after((s) => s.replace('order(id: ID!)', 'order(id: ID!, shop: ID!, preview: Boolean)')) }))['Query.order']
    assert.equal(change.level, 'breaking')
    assert.deepEqual(change.details, ['인자 shop: ID!을(를) 더했다(필수)', '인자 preview: Boolean을(를) 더했다'])
  })

  it('enum 값을 지우면 깨질 수 있음이고, 그 enum을 돌려주거나 인자로 받는 필드가 사용처 대상이다', () => {
    const change = keyed(diffSchema({ before: sdl(SCHEMA), after: after((s) => s.replace('PAID SHIPPED CANCELLED', 'PAID SHIPPED REFUNDED')) }))['OrderStatus']
    assert.equal(change.level, 'breaking')
    assert.deepEqual(change.details, ["enum 값 'CANCELLED'을(를) 지웠다", "enum 값 'REFUNDED'을(를) 더했다"])
    assert.deepEqual(change.affects, ['Order.status', 'Query.orders'])
  })

  it('input에 필수 필드를 더하면 깨질 수 있음이고, 그 input을 (중첩까지) 인자로 받는 필드가 사용처 대상이다', () => {
    const change = keyed(diffSchema({ before: sdl(SCHEMA), after: after((s) => s.replace('input ItemInput { sku: String! qty: Int! }', 'input ItemInput { sku: String! qty: Int! shop: ID! }')) }))['ItemInput.shop']
    assert.deepEqual([change.level, change.affects], ['breaking', ['Mutation.placeOrder']])
  })

  it('타입을 지우면 그 타입의 필드와 그 타입을 돌려주는 필드가 모두 사용처 대상이다. 바뀐 것이 없으면 빈 목록이다', () => {
    const change = keyed(diffSchema({ before: sdl(SCHEMA), after: after((s) => s.replace('type OrderItem { sku: String! qty: Int! }', '').replace('items: [OrderItem!]!', '').replace('Order | OrderItem', 'Order')) }))['OrderItem']
    assert.deepEqual([change.change, change.level], ['removed', 'breaking'])
    assert.deepEqual(change.affects, ['Order.items', 'OrderItem.qty', 'OrderItem.sku'])
    assert.deepEqual(diffSchema({ before: sdl(SCHEMA), after: sdl(SCHEMA) }), [])
  })
})

describe('resolveOperations — 연산을 스키마로 풀기', () => {
  const doc = (text, line = 1) => ({ path: 'src/order.ts', text, line })
  const uses = (result) => result.uses.map((u) => `${u.typeName}.${u.fieldName}@${u.line} ${u.operation} › ${u.fieldPath}`)

  it('선택한 필드마다 어느 타입의 필드인지 정한다 — 별칭·인자·중첩·__typename', () => {
    const result = resolveOperations({ schema: sdl(SCHEMA), documents: [doc('query GetOrder($id: ID!) {\n  o: order(id: $id) {\n    __typename\n    totalAmount\n    items { sku }\n  }\n}', 10)] })
    assert.deepEqual(uses(result), [
      'Query.order@11 query GetOrder › order',
      'Order.totalAmount@13 query GetOrder › order.totalAmount',
      'Order.items@14 query GetOrder › order.items',
      'OrderItem.sku@14 query GetOrder › order.items.sku',
    ])
  })

  it('조각(fragment)은 조각이 쓰인 곳에서, 인라인 조각은 그 타입으로 푼다', () => {
    const result = resolveOperations({
      schema: sdl(SCHEMA),
      documents: [doc('fragment OrderFields on Order { id totalAmount }'), doc('query { search(q: "x") { ... on OrderItem { qty } ...OrderFields } }')],
    })
    assert.deepEqual(uses(result), ['Order.id@1 fragment OrderFields › id', 'Order.totalAmount@1 fragment OrderFields › totalAmount', 'Query.search@1 query › search', 'OrderItem.qty@1 query › search.qty'])
  })

  it('스키마에 없는 필드도 부모 타입과 함께 남긴다 — 지운 필드의 사용처를 찾는다. 읽지 못한 문서는 이유와 함께 남긴다', () => {
    const result = resolveOperations({ schema: sdl(SCHEMA), documents: [doc('query { order(id: 1) { discount } }'), doc('query {', 7)] })
    assert.deepEqual(uses(result), ['Query.order@1 query › order', 'Order.discount@1 query › order.discount'])
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /src\/order\.ts:7/)
  })
})

describe('extractDocuments — 코드 안의 GraphQL', () => {
  it('gql·graphql 태그 템플릿, graphql(`…`) 호출, /* GraphQL */ 주석 템플릿을 꺼낸다 — ${}는 지우고 줄 번호는 지킨다', () => {
    const text = [
      "import { gql } from '@apollo/client'",
      'export const Q = gql`',
      '  query A { order(id: 1) { id } }',
      '  ${OrderFields}',
      '`',
      'const B = graphql(`query B { orders { id } }`)',
      'const C = /* GraphQL */ `query C { search(q: "x") { __typename } }`',
      'const notGraphql = `query D { x }`',
    ].join('\n')
    const docs = extractDocuments({ path: 'src/a.ts', text })
    assert.deepEqual(docs.map((d) => [d.line, d.text.trim().split('\n')[0]]), [
      [2, 'query A { order(id: 1) { id } }'],
      [6, 'query B { orders { id } }'],
      [7, 'query C { search(q: "x") { __typename } }'],
    ])
    assert.doesNotMatch(docs[0].text, /\$\{/)
  })

  it('.graphql 파일은 통째로 한 문서다', () => {
    assert.deepEqual(extractDocuments({ path: 'src/order.graphql', text: 'query A { id }' }).map((d) => [d.line, d.text]), [[1, 'query A { id }']])
  })
})
