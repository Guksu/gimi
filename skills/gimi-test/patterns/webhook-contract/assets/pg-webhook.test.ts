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

// 웹훅은 테스트가 직접 만들어 보낸다 — 서명은 PG와 같은 방식으로 붙이고, 틀린 서명·본문은 일부러 만든다
let sequence = 0
const statusChanged = (paymentKey: string, orderId: number, status: string, eventId = `evt-${++sequence}`) => ({
  eventId,
  type: 'PAYMENT_STATUS_CHANGED',
  createdAt: '2026-10-21T03:00:00.000Z',
  data: { paymentKey, orderId: String(orderId), status },
})
const send = (event: unknown, signature?: string) => {
  const raw = JSON.stringify(event)
  return request(t.app.getHttpServer())
    .post('/webhooks/pg')
    .set('content-type', 'application/json')
    .set('x-fakepg-signature', signature ?? signWebhook(KEYS.webhookSecret, raw))
    .send(raw)
}
const statusOf = async (id: number) => (await t.as(1).get(`/orders/${id}`)).body.status
const confirm = (orderId: number, paymentKey: string, amount: number) => t.as(1).post('/payments/confirm').send({ orderId, paymentKey, amount })

describe('PG 웹훅 — 계약의 경우마다', () => {
  it('서명이 틀리면 401이고 주문은 그대로다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)

    const res = await send(statusChanged(paymentKey, order.id, 'DONE'), 'v1=forged')

    expect(res.status).toBe(401)
    expect(await statusOf(order.id)).toBe('pending_payment')
  })

  it('본문이 결제 완료라고 해도 PG에서 아직 승인 전이면 주문을 바꾸지 않는다 — 본문을 믿지 않고 다시 조회한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)

    // 서명은 맞지만 본문의 상태가 PG의 지금 상태(READY)와 다르다
    const res = await send(statusChanged(paymentKey, order.id, 'DONE'))

    expect(res.status).toBe(200)
    expect(await statusOf(order.id)).toBe('pending_payment')
  })

  it('같은 이벤트가 두 번 오면 두 번째는 처리하지 않고 200으로 답한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    await confirm(order.id, paymentKey, order.total)
    await t.pg.flushWebhooks()

    const event = statusChanged(paymentKey, order.id, 'DONE', 'evt-repeat')
    const first = await send(event)
    const again = await send(event)

    expect([first.status, again.status]).toEqual([200, 200])
    expect(again.body).toMatchObject({ duplicate: true })
    expect((await t.db.query("SELECT count(*)::int AS n FROM webhook_events WHERE event_id = 'evt-repeat'")).rows[0].n).toBe(1)
  })

  it('순서가 바뀌어 옛 이벤트(결제 완료)가 취소 뒤에 와도 주문은 취소 그대로다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    await confirm(order.id, paymentKey, order.total)
    await t.as(1).post(`/orders/${order.id}/cancel`).send({ reason: '단순 변심' })
    await t.pg.flushWebhooks()

    await send(statusChanged(paymentKey, order.id, 'DONE'))

    expect(await statusOf(order.id)).toBe('cancelled')
  })

  it('모르는 type은 200으로 받고 아무것도 바꾸지 않는다 — 오류로 답하면 PG가 계속 다시 보낸다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)

    const res = await send({ ...statusChanged(paymentKey, order.id, 'DONE'), type: 'SETTLEMENT_REPORTED' })

    expect(res.status).toBe(200)
    expect(await statusOf(order.id)).toBe('pending_payment')
  })
})
