import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const confirm = (body: Record<string, unknown>) => t.as(1).post('/payments/confirm').send(body)
const pointsOf = async (user = 1) => (await t.db.query('SELECT points FROM users WHERE id = $1', [user])).rows[0].points

describe('POST /orders/:id/checkout', () => {
  it('서버에 저장한 금액으로 결제창을 연다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    expect(t.pg.payments.get(paymentKey)).toMatchObject({ orderId: String(order.id), totalAmount: 15000, method: 'card' })
  })

  it('결제 대기가 아닌 주문과 남의 주문은 결제창을 열 수 없다', async () => {
    const { order } = await orderWithCheckout(t)
    expect((await t.as(2).post(`/orders/${order.id}/checkout`)).status).toBe(404)
    await t.db.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id])
    expect((await t.as(1).post(`/orders/${order.id}/checkout`)).body.code).toBe('NOT_PAYABLE')
  })
})

describe('POST /payments/confirm', () => {
  it('저장한 금액과 같으면 PG에 승인을 받고 결제 완료로 바꾼다 — 포인트는 결제 금액의 1%를 한 번 적립한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    const res = await confirm({ orderId: order.id, paymentKey, amount: 15000 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'paid', pointsEarned: 150 })
    expect(t.pg.payments.get(paymentKey)?.status).toBe('DONE')
    expect(await pointsOf()).toBe(5150)
  })

  it('돌아온 금액이 저장한 금액과 다르면 PG를 부르지 않고 거절한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    const res = await confirm({ orderId: order.id, paymentKey, amount: 100 })
    expect([res.status, res.body.code]).toEqual([400, 'AMOUNT_MISMATCH'])
    expect(t.pg.payments.get(paymentKey)?.status).toBe('READY')
  })

  it('같은 결제를 동시에 두 번 확정해도 한 번만 반영한다 — 포인트 적립도 한 번', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    const both = await Promise.all([confirm({ orderId: order.id, paymentKey, amount: 15000 }), confirm({ orderId: order.id, paymentKey, amount: 15000 })])
    expect(both.every((r) => r.status === 200 && r.body.status === 'paid')).toBe(true)
    expect(await pointsOf()).toBe(5150)
    expect((await t.db.query('SELECT count(*)::int AS n FROM payments')).rows[0].n).toBe(1)
  })

  it('승인 응답이 늦어 시간을 넘기면 실패로 단정하지 않고 PG에 조회해 결과를 정한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    t.pg.behavior.confirm = 'slow'
    t.pg.behavior.delayMs = 500
    const res = await confirm({ orderId: order.id, paymentKey, amount: 15000 })
    expect([res.status, res.body.status]).toEqual([200, 'paid'])
  })

  it('PG 오류로 승인이 안 됐으면 주문은 결제 대기 그대로이고 다시 시도할 수 있다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    t.pg.behavior.confirm = 'error'
    const res = await confirm({ orderId: order.id, paymentKey, amount: 15000 })
    expect([res.status, res.body.code]).toEqual([502, 'PG_UNAVAILABLE'])
    expect((await t.as(1).get(`/orders/${order.id}`)).body.status).toBe('pending_payment')
    t.pg.behavior.confirm = 'ok'
    expect((await confirm({ orderId: order.id, paymentKey, amount: 15000 })).body.status).toBe('paid')
  })

  it('카드사가 거절하면 결제 실패이고, 같은 주문으로 다시 결제할 수 있다 — 취소하면 재고·쿠폰·포인트를 돌려준다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t, { couponCode: 'NOODLE10', points: 1000 })
    t.pg.behavior.confirm = 'reject'
    const res = await confirm({ orderId: order.id, paymentKey, amount: order.total })
    expect([res.status, res.body.code]).toEqual([402, 'PAYMENT_REJECTED'])
    expect((await t.as(1).get(`/orders/${order.id}`)).body.status).toBe('payment_failed')

    t.pg.behavior.confirm = 'ok'
    const retry = await t.as(1).post(`/orders/${order.id}/checkout`)
    expect(retry.status).toBe(201)
    expect((await confirm({ orderId: order.id, paymentKey: retry.body.paymentKey, amount: order.total })).body.status).toBe('paid')
  })

  it('결제 실패 주문을 취소하면 묶어 둔 재고·쿠폰·포인트를 돌려준다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t, { couponCode: 'NOODLE10', points: 1000 })
    t.pg.behavior.confirm = 'reject'
    await confirm({ orderId: order.id, paymentKey, amount: order.total })
    expect((await t.as(1).post(`/orders/${order.id}/cancel`).send({ reason: '결제 실패' })).body.status).toBe('cancelled')
    expect((await t.db.query('SELECT stock FROM products WHERE id = 1')).rows[0].stock).toBe(20)
    expect(await pointsOf()).toBe(5000)
    expect((await t.db.query("SELECT used_count FROM coupons WHERE code = 'NOODLE10'")).rows[0].used_count).toBe(0)
  })

  it('가상계좌는 입금 대기이고 결제 완료로 치지 않는다 — 포인트도 적립하지 않는다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t, { method: 'virtual_account' })
    const res = await confirm({ orderId: order.id, paymentKey, amount: 15000 })
    expect(res.body).toMatchObject({ status: 'waiting_for_deposit', pointsEarned: 0 })
    expect(await pointsOf()).toBe(5000)
  })
})
