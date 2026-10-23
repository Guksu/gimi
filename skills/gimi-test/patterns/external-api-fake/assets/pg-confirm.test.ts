import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

// PG는 HTTP 가짜 서버(fake-pg)다 — 앱의 HTTP 클라이언트·타임아웃·오류 변환은 실물로 돈다.
// 가짜 서버의 behavior로 승인·거절·오류·늦은 응답을 만든다
let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const confirm = (orderId: number, paymentKey: string, amount: number) => t.as(1).post('/payments/confirm').send({ orderId, paymentKey, amount })
const statusOf = async (id: number) => (await t.as(1).get(`/orders/${id}`)).body.status

describe('PG 승인 — 가짜 PG 서버의 응답마다', () => {
  it('승인(200)이면 결제 완료이고, PG에도 승인으로 남는다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)

    const res = await confirm(order.id, paymentKey, order.total)

    expect([res.status, res.body.status]).toEqual([200, 'paid'])
    expect(t.pg.payments.get(paymentKey)?.status).toBe('DONE')
  })

  it('카드사 거절(4xx)이면 결제 실패이고, 결제창을 다시 열어 같은 주문으로 결제할 수 있다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    t.pg.behavior.confirm = 'reject'

    const res = await confirm(order.id, paymentKey, order.total)
    expect([res.status, res.body.code]).toEqual([402, 'PAYMENT_REJECTED'])
    expect(await statusOf(order.id)).toBe('payment_failed')

    t.pg.behavior.confirm = 'ok'
    const retry = await t.as(1).post(`/orders/${order.id}/checkout`)
    expect((await confirm(order.id, retry.body.paymentKey, order.total)).body.status).toBe('paid')
  })

  it('PG 오류(5xx)면 실패로 단정하지 않는다 — 주문은 결제 대기 그대로이고 다시 시도할 수 있다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    t.pg.behavior.confirm = 'error'

    const res = await confirm(order.id, paymentKey, order.total)

    expect([res.status, res.body.code]).toEqual([502, 'PG_UNAVAILABLE'])
    expect(await statusOf(order.id)).toBe('pending_payment')
  })

  it('응답이 시간을 넘기면 실패로 단정하지 않고 PG에 조회해 결과를 정한다 — PG는 이미 승인했다', async () => {
    // 시간 제한을 짧게 다시 띄우고, 가짜 PG는 승인한 뒤 그보다 늦게 답한다
    await t.close()
    t = await startApp({ pgTimeoutMs: 300 })
    const { order, paymentKey } = await orderWithCheckout(t)
    t.pg.behavior.confirm = 'slow'
    t.pg.behavior.delayMs = 1000

    const res = await confirm(order.id, paymentKey, order.total)

    expect([res.status, res.body.status]).toEqual([200, 'paid'])
    expect(t.pg.payments.get(paymentKey)?.status).toBe('DONE')
  })
})
