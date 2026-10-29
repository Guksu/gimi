import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.db.query('DROP TRIGGER IF EXISTS injected_failure ON order_items')
  await t.close()
})

// 슬롭 — 실패를 넣고 응답과 주문 수만 본다. 주문은 롤백됐어도 트랜잭션 밖에서 바꾼 포인트·재고가 남는지는 보지 않는다
describe('주문 실패', () => {
  it('주문 저장이 실패하면 오류를 돌려주고 주문이 생기지 않는다', async () => {
    await t.db.query("CREATE OR REPLACE FUNCTION injected_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$ LANGUAGE plpgsql")
    await t.db.query('CREATE TRIGGER injected_failure BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION injected_failure()')

    const res = await t.as(1).post('/orders').set('idempotency-key', 'k-fail').send({ method: 'card', items: [{ productId: 1, quantity: 2 }], couponCode: 'NOODLE10', points: 1000 })

    expect(res.status).toBe(500)
    const orders = await t.db.query('SELECT id FROM orders')
    expect(orders.rowCount).toBe(0)
  })
})
