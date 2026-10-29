import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  // 넣은 실패는 표를 비워도 남는다 — 테스트마다 지운다
  await t.db.query('DROP TRIGGER IF EXISTS injected_failure ON order_items')
  await t.close()
})

const one = async (sql: string) => (await t.db.query<{ n: number }>(sql)).rows[0]?.n

// 주문 하나가 건드리는 것을 모두 센다 — 실패한 주문은 이 가운데 아무것도 바꾸지 않아야 한다
const touched = async () => ({
  orders: await one('SELECT count(*)::int AS n FROM orders'),
  stock: await one('SELECT stock AS n FROM products WHERE id = 1'),
  couponUsed: await one("SELECT used_count AS n FROM coupons WHERE code = 'NOODLE10'"),
  couponUses: await one('SELECT count(*)::int AS n FROM coupon_uses'),
  points: await one('SELECT points AS n FROM users WHERE id = 1'),
})

// 트랜잭션의 마지막 단계(주문 상품 저장)를 실패시킨다 — 그 앞의 재고·쿠폰·포인트 차감이 모두 되돌아가는지 본다
const failOrderItems = async () => {
  await t.db.query("CREATE OR REPLACE FUNCTION injected_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$ LANGUAGE plpgsql")
  await t.db.query('CREATE TRIGGER injected_failure BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION injected_failure()')
}

const order = (key: string) =>
  t.as(1).post('/orders').set('idempotency-key', key).send({ method: 'card', items: [{ productId: 1, quantity: 2 }], couponCode: 'NOODLE10', points: 1000 })

describe('실패하면 되돌리고, 외부 호출은 커밋 뒤에', () => {
  it('주문 저장의 마지막 단계가 실패하면 재고·쿠폰·포인트가 모두 주문 전 그대로다', async () => {
    const before = await touched()
    await failOrderItems()

    const res = await order('k-fail')

    expect(res.status).toBe(500)
    expect(await touched()).toEqual(before)
  })

  it('같은 주문이 성공하면 모두 한 번씩 바뀐다 — 위 테스트가 세는 값이 맞는지 확인한다', async () => {
    const res = await order('k-ok')

    expect(res.status).toBe(201)
    expect(await touched()).toEqual({ orders: 1, stock: 18, couponUsed: 1, couponUses: 1, points: 4000 })
  })

  it('PG 승인이 오류면 결제 기록도 적립도 없이 주문은 결제 대기다 — PG를 먼저 부르고 결과를 받은 뒤에 저장한다', async () => {
    const { order: created, paymentKey } = await orderWithCheckout(t)
    t.pg.behavior.confirm = 'error'

    const res = await t.as(1).post('/payments/confirm').send({ orderId: created.id, paymentKey, amount: created.total })

    expect(res.status).toBe(502)
    expect((await t.as(1).get(`/orders/${created.id}`)).body.status).toBe('pending_payment')
    expect(await one('SELECT count(*)::int AS n FROM payments')).toBe(0)
    expect(await one('SELECT points AS n FROM users WHERE id = 1')).toBe(5000)
  })
})
