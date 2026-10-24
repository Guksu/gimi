import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

// 슬롭 — 상태 코드와 눈에 띄는 필드 두어 개만 본다. 계약의 필수 필드(canCancel 등)가 빠져도 통과한다
describe('주문 API', () => {
  it('주문 상세를 가져온다', async () => {
    const { order } = await orderWithCheckout(t)

    const res = await t.as(1).get(`/orders/${order.id}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(order.id)
    expect(res.body.status).toBe('pending_payment')
  })
})
