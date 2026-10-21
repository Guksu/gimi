import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { diffOpenApi, isOpenApi } from '../skills/gimi-review/scripts/lib/openapi.mjs'

const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
const json = (schema) => ({ content: { 'application/json': { schema } } })
const base = () => ({
  openapi: '3.0.3',
  paths: {
    '/orders/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { responses: { 200: { description: 'ok', ...json(ref('Order')) }, 404: { description: 'none' } } },
    },
    '/orders': {
      post: { requestBody: { required: true, ...json(ref('OrderInput')) }, responses: { 201: { description: 'made', ...json(ref('Order')) } } },
      get: { parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'list', ...json({ type: 'array', items: ref('Order') }) } } },
    },
    '/health': { get: { responses: { 200: { description: 'ok' } } } },
  },
  components: {
    schemas: {
      Order: { type: 'object', required: ['id', 'totalAmount'], properties: { id: { type: 'string' }, totalAmount: { type: 'integer' }, status: { $ref: '#/components/schemas/OrderStatus' }, items: { type: 'array', items: ref('OrderItem') } } },
      OrderItem: { type: 'object', properties: { sku: { type: 'string' }, qty: { type: 'integer' } } },
      OrderStatus: { type: 'string', enum: ['paid', 'shipped', 'cancelled'] },
      OrderInput: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: ref('OrderItem') }, coupon: { type: 'string' } } },
    },
  },
})
const keyed = (changes) => Object.fromEntries(changes.map((c) => [c.key, c]))

describe('isOpenApi', () => {
  it('openapi·swagger 판과 paths·components가 있는 문서만 계약으로 본다', () => {
    assert.equal(isOpenApi(base()), true)
    assert.equal(isOpenApi({ swagger: '2.0', paths: {} }), true)
    assert.equal(isOpenApi({ name: 'pkg', version: '1.0.0' }), false)
    assert.equal(isOpenApi(null), false)
  })
})

describe('diffOpenApi — 엔드포인트', () => {
  it('지운 엔드포인트는 깨질 수 있음, 더한 엔드포인트는 추가다', () => {
    const after = base()
    delete after.paths['/health']
    after.paths['/coupons'] = { get: { responses: { 200: { description: 'ok' } } } }
    const changes = keyed(diffOpenApi({ before: base(), after }))
    assert.deepEqual([changes['GET /health'].change, changes['GET /health'].level], ['removed', 'breaking'])
    assert.deepEqual([changes['GET /coupons'].change, changes['GET /coupons'].level], ['added', 'additive'])
  })

  it('필수 파라미터를 더하거나 타입을 바꾸면 깨질 수 있음, 선택 파라미터를 더하면 추가다', () => {
    const after = base()
    after.paths['/orders'].get.parameters = [{ name: 'page', in: 'query', schema: { type: 'string' } }, { name: 'shop', in: 'query', required: true, schema: { type: 'string' } }, { name: 'sort', in: 'query', schema: { type: 'string' } }]
    const change = keyed(diffOpenApi({ before: base(), after }))['GET /orders']
    assert.equal(change.level, 'breaking')
    assert.deepEqual(change.details, ['파라미터 query page 타입 integer → string', '파라미터 query shop을(를) 더했다(필수)', '파라미터 query sort을(를) 더했다'])
  })

  it('응답 코드를 지우면 깨질 수 있음, 응답 스키마가 바뀌면 그것도 적는다', () => {
    const after = base()
    delete after.paths['/orders/{id}'].get.responses[404]
    after.paths['/orders'].post.responses[201] = { description: 'made', ...json(ref('OrderSummary')) }
    const changes = keyed(diffOpenApi({ before: base(), after }))
    assert.deepEqual(changes['GET /orders/{id}'].details, ['응답 404을(를) 지웠다'])
    assert.deepEqual(changes['POST /orders'].details, ['응답 201 Order → OrderSummary'])
  })

  it('Swagger 2.0의 body 파라미터와 definitions도 읽는다', () => {
    const doc = (amount) => ({ swagger: '2.0', paths: { '/pay': { post: { parameters: [{ name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/Pay' } }], responses: { 200: { description: 'ok' } } } } }, definitions: { Pay: { type: 'object', properties: { amount: { type: amount } } } } })
    const changes = keyed(diffOpenApi({ before: doc('integer'), after: doc('string') }))
    assert.deepEqual(changes['Pay.amount'].details, ['타입 integer → string'])
    assert.deepEqual(changes['Pay.amount'].endpoints, ['POST /pay'])
  })
})

describe('diffOpenApi — 스키마', () => {
  it('필드를 지우면 깨질 수 있음이고, 그 스키마를 쓰는 엔드포인트를 $ref를 따라가 모두 적는다', () => {
    const after = base()
    delete after.components.schemas.OrderItem.properties.qty
    const change = keyed(diffOpenApi({ before: base(), after }))['OrderItem.qty']
    assert.deepEqual([change.change, change.level, change.schema, change.field], ['removed', 'breaking', 'OrderItem', 'qty'])
    assert.deepEqual(change.endpoints, ['GET /orders', 'GET /orders/{id}', 'POST /orders'])
  })

  it('타입·null 허용·필수·enum 값이 바뀌면 한 필드의 바뀜으로 모아 적고 가장 무거운 등급을 붙인다', () => {
    const after = base()
    after.components.schemas.Order.properties.totalAmount = { type: 'number', nullable: true }
    after.components.schemas.Order.required = ['id']
    after.components.schemas.OrderStatus.enum = ['paid', 'shipped', 'refunded']
    const changes = keyed(diffOpenApi({ before: base(), after }))
    assert.equal(changes['Order.totalAmount'].level, 'breaking')
    assert.deepEqual(changes['Order.totalAmount'].details, ['타입 integer → number', 'null을 허용하게 됐다', '필수에서 빠졌다'])
    assert.equal(changes.OrderStatus.level, 'breaking')
    assert.deepEqual(changes.OrderStatus.details, ["enum 값 'cancelled'을(를) 지웠다", "enum 값 'refunded'을(를) 더했다"])
  })

  it('필드를 더하면 추가(필수면 확인), 스키마를 더하면 추가다. 바뀐 것은 깨질 수 있음 → 확인 → 추가 순서다', () => {
    const after = base()
    after.components.schemas.OrderInput.properties.memo = { type: 'string' }
    after.components.schemas.OrderInput.properties.shop = { type: 'string' }
    after.components.schemas.OrderInput.required = ['items', 'shop']
    after.components.schemas.Coupon = { type: 'object', properties: { code: { type: 'string' } } }
    delete after.paths['/health']
    const changes = diffOpenApi({ before: base(), after })
    assert.deepEqual(changes.map((c) => [c.key, c.level]), [
      ['GET /health', 'breaking'],
      ['OrderInput.shop', 'caution'],
      ['Coupon', 'additive'],
      ['OrderInput.memo', 'additive'],
    ])
  })

  it('바뀐 것이 없으면 빈 목록이다', () => {
    assert.deepEqual(diffOpenApi({ before: base(), after: base() }), [])
  })
})
