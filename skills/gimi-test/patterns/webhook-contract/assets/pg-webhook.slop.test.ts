import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

// 슬롭 — 정상 이벤트 하나만 본다. 웹훅 본문의 상태가 PG의 상태와 같아서, 본문을 그대로 믿는 핸들러도 통과한다
describe('가상계좌 웹훅', () => {
  it('입금 웹훅이 오면 결제 완료가 된다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t, { method: 'virtual_account' })
    await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: order.total })

    await t.pg.deposit(paymentKey)
    await t.pg.flushWebhooks()

    expect((await t.as(1).get(`/orders/${order.id}`)).body.status).toBe('paid')
  })
})
