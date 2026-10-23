import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

/** 결제까지 마친 주문을 그 시각에 배송 완료로 둔다 */
const deliveredAt = async (at: string) => {
  const { order, paymentKey } = await orderWithCheckout(t)
  await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: order.total })
  await t.db.query("UPDATE orders SET status = 'delivered', delivered_at = $2 WHERE id = $1", [order.id, at])
  return order.id as number
}
const requestReturn = (id: number, reason: 'change_of_mind' | 'defective') => t.as(1).post(`/orders/${id}/returns`).send({ reason })

// 규칙(KCL-001)의 경계값을 표로 옮긴다 — 받은 날은 세지 않고 다음 날부터 7일째 23:59:59(한국 시간)까지 받는다.
// 경계 바로 안(23:59:59.999)과 바로 밖(00:00)을 한 쌍으로 둔다. 시각은 UTC로 적는다(KST = UTC + 9)
const DELIVERED = '2026-10-21T03:30:00.000Z' // 10월 21일 12:30(KST)

describe('청약철회 기한 — 7일째 23:59(KST)까지 받고 8일째 00:00부터 막는다', () => {
  it.each([
    { when: '배송 당일 밤 23:59:59.999', now: '2026-10-21T14:59:59.999Z', status: 201 },
    { when: '7일째(10월 28일) 23:59:59.999', now: '2026-10-28T14:59:59.999Z', status: 201 },
    { when: '8일째(10월 29일) 00:00', now: '2026-10-28T15:00:00.000Z', status: 409 },
  ])('단순 변심 — $when → $status', async ({ now, status }) => {
    const id = await deliveredAt(DELIVERED)
    t.clock.set(now)
    expect((await requestReturn(id, 'change_of_mind')).status).toBe(status)
  })

  it('밤 11시 30분(KST)에 받아도 그날은 세지 않는다 — 마감은 같은 10월 29일 00:00이다', async () => {
    const id = await deliveredAt('2026-10-21T14:30:00.000Z')
    t.clock.set('2026-10-28T14:59:59.999Z')
    expect((await requestReturn(id, 'change_of_mind')).status).toBe(201)
  })

  it('화면에 보이는 마감 바로 전까지 받는다 — 표시와 판정이 같은 기한을 쓴다', async () => {
    const id = await deliveredAt(DELIVERED)
    const { returnDeadline } = (await t.as(1).get(`/orders/${id}`)).body
    expect(returnDeadline).toBe('2026-10-28T15:00:00.000Z')
    t.clock.set('2026-10-28T14:59:59.999Z')
    expect((await requestReturn(id, 'change_of_mind')).status).toBe(201)
  })

  it.each([
    { when: '90일째(1월 19일) 23:59:59.999', now: '2027-01-19T14:59:59.999Z', status: 201 },
    { when: '91일째(1월 20일) 00:00', now: '2027-01-19T15:00:00.000Z', status: 409 },
  ])('상품 하자 — $when → $status', async ({ now, status }) => {
    const id = await deliveredAt(DELIVERED)
    t.clock.set(now)
    expect((await requestReturn(id, 'defective')).status).toBe(status)
  })
})
