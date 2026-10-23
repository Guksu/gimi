import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const confirm = (orderId: number, paymentKey: string, amount: number) => t.as(1).post('/payments/confirm').send({ orderId, paymentKey, amount })

// 슬롭 — 같은 확정을 두 번 보내고 응답만 본다. 포인트·결제 기록 같은 부수효과를 세지 않아 두 번 반영돼도 통과한다
describe('결제 확정', () => {
  it('같은 결제를 두 번 확정해도 성공한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)

    const first = await confirm(order.id, paymentKey, order.total)
    const again = await confirm(order.id, paymentKey, order.total)

    expect(first.status).toBe(200)
    expect(again.status).toBe(200)
    expect(again.body.status).toBe('paid')
  })
})
