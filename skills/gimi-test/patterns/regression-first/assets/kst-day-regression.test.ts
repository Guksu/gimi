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
const requestReturn = (id: number) => t.as(1).post(`/orders/${id}/returns`).send({ reason: 'change_of_mind' })

// 재현 테스트 — 신고("새벽에 받은 주문은 반품 기한이 하루 짧다")의 조건을 그대로 옮겼다.
// 한국 시간 새벽(00:00~09:00)은 UTC로 전날이다. 고치기 전 코드에서 이 파일이 실패하는 것을 먼저 보고 고쳤다
describe('회귀 — 새벽에 받은 주문의 반품 기한', () => {
  it('10월 22일 01:00(KST)에 받으면 10월 29일 23:59(KST)까지 반품을 받는다', async () => {
    const id = await deliveredAt('2026-10-21T16:00:00.000Z')

    t.clock.set('2026-10-29T14:59:59.999Z')

    expect((await requestReturn(id)).status).toBe(201)
  })

  it('같은 주문의 화면 마감도 10월 30일 00:00(KST)이다', async () => {
    const id = await deliveredAt('2026-10-21T16:00:00.000Z')

    expect((await t.as(1).get(`/orders/${id}`)).body.returnDeadline).toBe('2026-10-29T15:00:00.000Z')
  })

  it('새벽의 끝(08:59 KST)에 받아도 같다', async () => {
    const id = await deliveredAt('2026-10-21T23:59:00.000Z')

    t.clock.set('2026-10-29T14:59:59.999Z')

    expect((await requestReturn(id)).status).toBe(201)
  })

  it('버그가 없던 조건(낮 12:00 KST 배송)도 그대로다 — 고친 코드가 다른 경우를 깨지 않았다', async () => {
    const id = await deliveredAt('2026-10-22T03:00:00.000Z')

    expect((await t.as(1).get(`/orders/${id}`)).body.returnDeadline).toBe('2026-10-29T15:00:00.000Z')
  })
})
