import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const paid = async (body: Record<string, unknown> = {}) => {
  const { order, paymentKey } = await orderWithCheckout(t, body)
  await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: order.total })
  return { order, paymentKey }
}
const cancel = (id: number, body: Record<string, unknown> = {}) => t.as(1).post(`/orders/${id}/cancel`).send({ reason: '단순 변심', ...body })
const detail = async (id: number) => (await t.as(1).get(`/orders/${id}`)).body

describe('POST /orders/:id/cancel — 취소·환불', () => {
  it('부분 취소는 남은 금액을 PG에 검증값으로 보내고, 누적 환불액이 결제액을 넘지 않는다', async () => {
    const { order, paymentKey } = await paid()
    const first = await cancel(order.id, { amount: 5000 })
    expect(first.body).toMatchObject({ status: 'partially_refunded', refundedAmount: 5000, refundableAmount: 10000 })
    expect(t.pg.payments.get(paymentKey)?.balanceAmount).toBe(10000)
    expect((await cancel(order.id, { amount: 10001 })).body.code).toBe('EXCEED_REFUNDABLE')
    expect((await cancel(order.id, { amount: 0 })).body.code).toBe('INVALID_AMOUNT')
    const rest = await cancel(order.id)
    expect(rest.body).toMatchObject({ status: 'cancelled', refundedAmount: 15000, refundableAmount: 0, canCancel: false })
  })

  it('동시에 같은 금액을 두 번 부분 취소해도 결제액을 넘게 돌려주지 않는다', async () => {
    const { order } = await paid()
    const both = await Promise.all([cancel(order.id, { amount: 10000 }), cancel(order.id, { amount: 10000 })])
    expect(both.map((r) => r.status).sort()).toEqual([200, 400])
    expect((await detail(order.id)).refundedAmount).toBe(10000)
  })

  it('전액 취소하면 재고를 되돌린다', async () => {
    const { order } = await paid()
    await cancel(order.id)
    expect((await t.db.query('SELECT stock FROM products WHERE id = 1')).rows[0].stock).toBe(20)
  })

  it('입금 전 가상계좌는 환불 없이 주문만 취소한다', async () => {
    const { order, paymentKey } = await paid({ method: 'virtual_account' })
    const res = await cancel(order.id)
    expect(res.body).toMatchObject({ status: 'cancelled', refundedAmount: 0 })
    expect(t.pg.payments.get(paymentKey)?.status).toBe('CANCELED')
  })

  it('배송을 시작한 주문은 취소할 수 없고, 화면은 서버가 준 canCancel로 버튼을 정한다', async () => {
    const { order } = await paid()
    expect((await detail(order.id)).canCancel).toBe(true)
    await t.db.query("UPDATE orders SET status = 'shipped' WHERE id = $1", [order.id])
    expect((await detail(order.id)).canCancel).toBe(false)
    expect((await cancel(order.id)).body.code).toBe('NOT_CANCELABLE')
  })
})

describe('POST /orders/:id/returns — 청약철회(반품)', () => {
  // 배송 완료: 한국 시간 2026-10-21 10:00
  const delivered = async (body: Record<string, unknown> = {}) => {
    const { order } = await paid(body)
    await t.db.query("UPDATE orders SET status = 'delivered', delivered_at = '2026-10-21T01:00:00Z' WHERE id = $1", [order.id])
    return order
  }
  const ret = (id: number, reason = 'change_of_mind') => t.as(1).post(`/orders/${id}/returns`).send({ reason })

  it('배송 완료일부터 7일째 23:59(한국 시간)까지 받고, 8일째 00:00부터는 막는다', async () => {
    const order = await delivered()
    expect((await detail(order.id)).returnDeadline).toBe('2026-10-28T15:00:00.000Z')
    t.clock.set('2026-10-28T14:59:59.999Z')
    expect((await detail(order.id)).canReturn).toBe(true)
    t.clock.set('2026-10-28T15:00:00.000Z')
    expect((await detail(order.id)).canReturn).toBe(false)
    expect((await ret(order.id)).body.code).toBe('RETURN_WINDOW_CLOSED')
    t.clock.set('2026-10-28T14:59:59.999Z')
    expect((await ret(order.id)).status).toBe(201)
  })

  it('새벽에 받은 주문도 받은 날을 한국 날짜로 센다 — 10월 22일 01:00(KST) 배송이면 10월 29일 23:59까지', async () => {
    const { order } = await paid()
    // 한국 날짜는 22일이지만 UTC 날짜는 21일이다 — 날짜 경계를 UTC로 잡으면 마감이 하루 이르다
    await t.db.query("UPDATE orders SET status = 'delivered', delivered_at = '2026-10-21T16:00:00Z' WHERE id = $1", [order.id])
    expect((await detail(order.id)).returnDeadline).toBe('2026-10-29T15:00:00.000Z')
    t.clock.set('2026-10-29T14:59:59.999Z')
    expect((await ret(order.id)).status).toBe(201)
  })

  it('반품 불가로 표시한 상품만 있는 주문은 단순 변심 반품을 막고, 상품 하자는 받는다', async () => {
    const order = await delivered({ items: [{ productId: 4, quantity: 1 }] })
    expect((await detail(order.id)).items[0].returnable).toBe(false)
    expect((await ret(order.id)).body.code).toBe('NOT_RETURNABLE')
    expect((await ret(order.id, 'defective')).status).toBe(201)
  })

  it('배송 완료 전에는 반품이 아니라 취소다', async () => {
    const { order } = await paid()
    expect((await ret(order.id)).body.code).toBe('NOT_DELIVERED')
  })
})
