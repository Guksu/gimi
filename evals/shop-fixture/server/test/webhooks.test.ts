import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { signWebhook } from 'fake-pg'
import { KEYS, orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const event = (overrides: Record<string, unknown> & { data: Record<string, unknown> }) => ({ eventId: `evt-${Math.random()}`, type: 'PAYMENT_STATUS_CHANGED', createdAt: '2026-10-21T03:00:00.000Z', ...overrides })
const post = (body: unknown, signature?: string) => {
  const raw = JSON.stringify(body)
  return request(t.app.getHttpServer())
    .post('/webhooks/pg')
    .set('content-type', 'application/json')
    .set('x-fakepg-signature', signature ?? signWebhook(KEYS.webhookSecret, raw))
    .send(raw)
}
const statusOf = async (id: number) => (await t.as(1).get(`/orders/${id}`)).body.status

describe('POST /webhooks/pg', () => {
  it('서명이 틀리거나 없으면 401이고 아무것도 바꾸지 않는다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    const body = event({ data: { paymentKey, orderId: String(order.id), status: 'DONE' } })
    expect((await post(body, 'v1=bad')).status).toBe(401)
    expect(await statusOf(order.id)).toBe('pending_payment')
  })

  it('본문의 상태를 믿지 않고 PG에 조회한 상태를 반영한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    // PG에서는 아직 승인 전(READY)인데 본문만 DONE이다
    expect((await post(event({ data: { paymentKey, orderId: String(order.id), status: 'DONE' } }))).status).toBe(200)
    expect(await statusOf(order.id)).toBe('pending_payment')
  })

  it('가상계좌 입금 웹훅이 오면 결제 완료로 바꾸고, 같은 이벤트가 두 번 와도 한 번만 반영한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t, { method: 'virtual_account' })
    await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: 15000 })
    await t.pg.flushWebhooks()
    await t.pg.deposit(paymentKey)
    await t.pg.flushWebhooks()
    expect(await statusOf(order.id)).toBe('paid')
    const again = event({ eventId: 'evt-repeat', data: { paymentKey, orderId: String(order.id), status: 'DONE' } })
    await post(again)
    await post(again)
    expect((await t.db.query('SELECT points FROM users WHERE id = 1')).rows[0].points).toBe(5150)
    expect((await t.db.query("SELECT count(*)::int AS n FROM webhook_events WHERE event_id = 'evt-repeat'")).rows[0].n).toBe(1)
  })

  it('결제를 확정한 뒤 같은 결제의 웹훅이 와도 포인트는 한 번만 쌓인다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: 15000 })
    // PG는 승인하면서 상태 변경 웹훅을 보낸다 — 그 웹훅까지 처리된 뒤에 본다
    await t.pg.flushWebhooks()
    expect(await statusOf(order.id)).toBe('paid')
    expect((await t.db.query('SELECT points FROM users WHERE id = 1')).rows[0].points).toBe(5150)
  })

  it('순서가 바뀌어 옛 이벤트가 늦게 와도 지금 상태(PG 조회)를 지킨다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: 15000 })
    await t.as(1).post(`/orders/${order.id}/cancel`).send({ reason: '단순 변심' })
    await t.pg.flushWebhooks()
    expect(await statusOf(order.id)).toBe('cancelled')
    await post(event({ data: { paymentKey, orderId: String(order.id), status: 'DONE' } }))
    expect(await statusOf(order.id)).toBe('cancelled')
  })

  it('모르는 type은 기록만 하고 200을 돌려준다 — 재전송 폭주를 부르지 않는다', async () => {
    const res = await post(event({ eventId: 'evt-new', type: 'REFUND_POLICY_UPDATED', data: { paymentKey: 'x', orderId: '1', status: 'DONE' } }))
    expect(res.status).toBe(200)
    expect((await t.db.query("SELECT handled FROM webhook_events WHERE event_id = 'evt-new'")).rows[0].handled).toBe('ignored')
  })

  it('PG가 모르는 상태 값을 돌려주면 주문 상태를 바꾸지 않고 보류로 기록한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    const payment = t.pg.payments.get(paymentKey)
    if (payment) payment.status = 'HOLDING_FOR_REVIEW' as never
    await post(event({ eventId: 'evt-odd', data: { paymentKey, orderId: String(order.id), status: 'HOLDING_FOR_REVIEW' } }))
    expect(await statusOf(order.id)).toBe('pending_payment')
    expect((await t.db.query("SELECT handled FROM webhook_events WHERE event_id = 'evt-odd'")).rows[0].handled).toBe('held:HOLDING_FOR_REVIEW')
  })
})
