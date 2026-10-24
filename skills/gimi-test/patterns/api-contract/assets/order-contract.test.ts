import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

// 응답을 계약(contracts/openapi.yaml)의 스키마로 검사한다 — 상태 코드만 보면 필드가 빠지거나 형이 바뀌어도 모른다.
// 계약은 web이 타입을 만드는 그 파일이다. 서버가 계약과 어긋나면 web이 깨진다
const contract = parse(readFileSync(join(__dirname, '../../contracts/openapi.yaml'), 'utf8')) as { components: object }
const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true })
ajv.addSchema({ components: contract.components }, 'contract')

/** 계약과 어긋난 곳 목록 — 맞으면 빈 배열. 실패하면 어느 필드가 왜 틀렸는지 그대로 보인다 */
const mismatches = (schema: string, body: unknown) => {
  const validate = ajv.getSchema(`contract#/components/schemas/${schema}`)
  if (!validate) throw new Error(`계약에 ${schema} 스키마가 없다`)
  return validate(body) ? [] : (validate.errors ?? []).map((error) => `${error.instancePath || '(전체)'} ${error.message}`)
}

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

describe('주문 API — 응답이 계약과 맞는다', () => {
  it('상품 목록의 항목은 Product다', async () => {
    const res = await t.as(1).get('/products')

    expect(res.status).toBe(200)
    for (const item of res.body.items) expect(mismatches('Product', item)).toEqual([])
  })

  it('금액 계산은 Quote다', async () => {
    const res = await t.as(1).post('/orders/quote').send({ method: 'card', items: [{ productId: 1, quantity: 2 }], couponCode: 'NOODLE10' })

    expect(res.status).toBe(200)
    expect(mismatches('Quote', res.body)).toEqual([])
  })

  it('주문 생성(201)과 주문 상세는 Order다 — 화면이 쓰는 canCancel·canReturn까지', async () => {
    const { order } = await orderWithCheckout(t)
    expect(mismatches('Order', order)).toEqual([])

    const detail = await t.as(1).get(`/orders/${order.id}`)

    expect(detail.status).toBe(200)
    expect(mismatches('Order', detail.body)).toEqual([])
  })

  it('배송 완료 주문(반품 기한이 있는 상태)도 Order다', async () => {
    const { order } = await orderWithCheckout(t)
    await t.db.query("UPDATE orders SET status = 'delivered', delivered_at = '2026-10-21T01:00:00Z' WHERE id = $1", [order.id])

    const detail = await t.as(1).get(`/orders/${order.id}`)

    expect(mismatches('Order', detail.body)).toEqual([])
  })

  it('오류 응답은 Error다 — 화면은 code로 문구를 고른다', async () => {
    const { order } = await orderWithCheckout(t)

    const res = await t.as(2).get(`/orders/${order.id}`)

    expect(res.status).toBe(404)
    expect(mismatches('Error', res.body)).toEqual([])
  })
})
