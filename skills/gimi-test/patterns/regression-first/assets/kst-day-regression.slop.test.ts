import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

// 슬롭 — 고친 뒤에 쓴 테스트. 버그가 나던 조건(새벽 배송)을 넣지 않고 낮 배송으로만 확인한다.
// 고치기 전 코드에서도 통과해서, 같은 버그가 다시 들어와도 모른다
describe('반품 기한', () => {
  it('배송 완료 7일 뒤까지 반품할 수 있다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: order.total })
    await t.db.query("UPDATE orders SET status = 'delivered', delivered_at = '2026-10-22T03:00:00Z' WHERE id = $1", [order.id])

    t.clock.set('2026-10-29T03:00:00.000Z')

    expect((await t.as(1).post(`/orders/${order.id}/returns`).send({ reason: 'change_of_mind' })).status).toBe(201)
  })
})
