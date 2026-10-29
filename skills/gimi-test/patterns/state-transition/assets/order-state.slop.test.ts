import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canTransition } from '../src/orders/order-state'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

// 슬롭 — 성공 경로 하나(결제 대기 → 결제 완료 → 배송 준비)만 따라간다. 막아야 하는 전이와 늦게 온 이벤트를 보지 않아, 취소한 주문이 되살아나도 통과한다
describe('주문 상태', () => {
  it('결제하면 결제 완료가 되고 배송 준비로 넘어갈 수 있다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)

    const res = await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: order.total })

    expect(res.body.status).toBe('paid')
    expect(canTransition('paid', 'preparing')).toBe(true)
  })
})
