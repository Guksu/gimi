import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const confirm = (orderId: number, paymentKey: string, amount: number) => t.as(1).post('/payments/confirm').send({ orderId, paymentKey, amount })
const one = async (sql: string) => (await t.db.query<{ n: number }>(sql)).rows[0]?.n

// 응답 코드가 아니라 부수효과를 센다 — 두 번 반영돼도 응답은 둘 다 200일 수 있다
const effects = async () => ({
  orders: await one('SELECT count(*)::int AS n FROM orders'),
  stock: await one('SELECT stock AS n FROM products WHERE id = 1'),
  payments: await one('SELECT count(*)::int AS n FROM payments'),
  points: await one('SELECT points AS n FROM users WHERE id = 1'),
})

describe('같은 일이 다시 와도 부수효과는 한 번', () => {
  it('같은 멱등 키로 주문을 다시 보내면 같은 주문을 돌려주고, 재고는 한 번만 줄어든다', async () => {
    const send = () => t.as(1).post('/orders').set('idempotency-key', 'retry-1').send({ method: 'card', items: [{ productId: 1, quantity: 2 }] })

    const first = await send()
    const again = await send()

    expect([first.status, again.status]).toEqual([201, 200])
    expect(again.body.id).toBe(first.body.id)
    expect(await effects()).toMatchObject({ orders: 1, stock: 18 })
  })

  it('결제 확정을 다시 보내도(새로고침·재시도) 결제 기록 1건, 포인트 적립 1번이다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)

    await confirm(order.id, paymentKey, order.total)
    const again = await confirm(order.id, paymentKey, order.total)

    expect(again.body.status).toBe('paid')
    // PG가 승인하며 보낸 상태 변경 웹훅까지 처리된 뒤에 센다
    await t.pg.flushWebhooks()
    expect(await effects()).toMatchObject({ payments: 1, points: 5150 })
  })

  it('확정 요청과 PG 웹훅이 같은 결제를 반영해도 포인트는 한 번 쌓인다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)

    await confirm(order.id, paymentKey, order.total)
    await t.pg.flushWebhooks()

    expect(await effects()).toMatchObject({ payments: 1, points: 5150 })
  })

  it('같은 결제 확정이 동시에 두 번 와도 한 번만 반영한다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)

    const both = await Promise.all([confirm(order.id, paymentKey, order.total), confirm(order.id, paymentKey, order.total)])

    expect(both.map((r) => r.status)).toEqual([200, 200])
    await t.pg.flushWebhooks()
    expect(await effects()).toMatchObject({ payments: 1, points: 5150 })
  })
})
