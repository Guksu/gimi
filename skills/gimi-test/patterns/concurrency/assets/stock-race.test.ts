import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './helpers'

// 실제 DB와 실제 앱 — 동시성은 저장소를 mock하면 재현되지 않는다
let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const order = (key: string, body: Record<string, unknown>, user = 1) => t.as(user).post('/orders').set('idempotency-key', key).send({ method: 'card', ...body })
const one = async (sql: string) => (await t.db.query<{ n: number }>(sql)).rows[0]?.n

describe('동시 주문 — 수량이 한정된 자원', () => {
  it('재고 1개 상품에 동시 주문 10건이면 1건만 성공하고, 재고는 0이며, 주문은 1건만 남는다', async () => {
    await t.db.query('UPDATE products SET stock = 1 WHERE id = 1')

    // 순서대로 기다리지 않고 한꺼번에 보낸다 — 확인과 차감 사이에 다른 요청이 끼어들 틈을 만든다
    const results = await Promise.all(Array.from({ length: 10 }, (_, n) => order(`race-${n}`, { items: [{ productId: 1, quantity: 1 }] })))

    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    // 진 요청은 모두 재고 충돌(409)이다 — 500으로 떨어지면 제약 위반을 처리하지 못한 것이다
    expect(results.filter((r) => r.status === 409)).toHaveLength(9)
    expect(await one('SELECT stock AS n FROM products WHERE id = 1')).toBe(0)
    expect(await one('SELECT count(*)::int AS n FROM orders')).toBe(1)
  })

  it('사용 한도 1인 쿠폰을 두 사람이 동시에 쓰면 1건만 성공한다', async () => {
    const results = await Promise.all([
      order('coupon-a', { items: [{ productId: 1, quantity: 1 }], couponCode: 'LAST1' }, 1),
      order('coupon-b', { items: [{ productId: 1, quantity: 1 }], couponCode: 'LAST1' }, 2),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await one("SELECT used_count AS n FROM coupons WHERE code = 'LAST1'")).toBe(1)
  })

  it('보유 포인트(5,000점)로 3,000점씩 쓰는 주문 두 건이 동시에 오면 1건만 성공하고 잔액은 음수가 되지 않는다', async () => {
    const results = await Promise.all([
      order('points-a', { items: [{ productId: 1, quantity: 1 }], points: 3000 }),
      order('points-b', { items: [{ productId: 1, quantity: 1 }], points: 3000 }),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await one('SELECT points AS n FROM users WHERE id = 1')).toBe(2000)
  })
})
