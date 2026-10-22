import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const deliveredAt = async (at: string) => {
  const { order, paymentKey } = await orderWithCheckout(t)
  await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: order.total })
  await t.db.query("UPDATE orders SET status = 'delivered', delivered_at = $2 WHERE id = $1", [order.id, at])
  return order.id as number
}
const requestReturn = (id: number) => t.as(1).post(`/orders/${id}/returns`).send({ reason: 'change_of_mind' })

// 슬롭 — 경계에서 먼 값 하나씩. 기한이 하루 짧거나 날짜 경계를 UTC로 잡아도 통과한다
describe('반품 기한', () => {
  it('배송 3일 뒤에는 반품할 수 있다', async () => {
    const id = await deliveredAt('2026-10-21T03:30:00.000Z')
    t.clock.set('2026-10-24T03:30:00.000Z')
    expect((await requestReturn(id)).status).toBe(201)
  })

  it('배송 한 달 뒤에는 반품할 수 없다', async () => {
    const id = await deliveredAt('2026-10-21T03:30:00.000Z')
    t.clock.set('2026-11-21T03:30:00.000Z')
    expect((await requestReturn(id)).status).toBe(409)
  })
})
