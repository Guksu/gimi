import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

// 실제 PostgreSQL(테스트 전용 데이터베이스)에 쓰고 읽는다 — 조회 조건(WHERE)과 제약(UNIQUE·CHECK·외래키)은
// DB가 지키므로 DB로 확인한다. startApp이 테스트마다 표를 비우고 시드를 다시 넣는다
let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const one = async (sql: string, params: unknown[] = []) => (await t.db.query<{ n: number | string }>(sql, params)).rows[0]?.n
/** SQL을 돌려 PostgreSQL 오류 코드를 돌려준다 — 성공하면 null */
const errorCodeOf = async (sql: string, params: unknown[]) => {
  try {
    await t.db.query(sql, params)
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
}

describe('주문 저장소 — 실제 DB로', () => {
  it('테스트는 빈 주문 표와 시드에서 시작한다 — 앞 테스트의 데이터가 남지 않는다', async () => {
    expect(await one('SELECT count(*)::int AS n FROM orders')).toBe(0)
    expect(await one('SELECT stock AS n FROM products WHERE id = 1')).toBe(20)
  })

  it('남의 주문은 조회·취소·반품 모두 없는 것과 같다(404) — 주문은 그대로다', async () => {
    const { order } = await orderWithCheckout(t) // 사용자 1의 주문

    expect((await t.as(2).get(`/orders/${order.id}`)).status).toBe(404)
    expect((await t.as(2).post(`/orders/${order.id}/cancel`).send({ reason: '단순 변심' })).status).toBe(404)
    expect((await t.as(2).post(`/orders/${order.id}/returns`).send({ reason: 'defective' })).status).toBe(404)
    expect(await one('SELECT status AS n FROM orders WHERE id = $1', [order.id])).toBe('pending_payment')
  })

  it('같은 사람의 같은 멱등 키는 DB가 하나만 남긴다(유니크 제약)', async () => {
    const { order } = await orderWithCheckout(t)

    const code = await errorCodeOf(
      `INSERT INTO orders (user_id, idempotency_key, status, method, subtotal, coupon_discount, points_used, shipping_fee, total)
       SELECT user_id, idempotency_key, status, method, subtotal, coupon_discount, points_used, shipping_fee, total FROM orders WHERE id = $1`,
      [order.id],
    )

    expect(code).toBe('23505') // unique_violation
  })

  it('환불 누적액은 결제액을 넘을 수 없다(CHECK 제약)', async () => {
    const { order } = await orderWithCheckout(t)

    expect(await errorCodeOf('UPDATE orders SET refunded_amount = total + 1 WHERE id = $1', [order.id])).toBe('23514') // check_violation
  })

  it('없는 상품을 담은 주문 품목은 저장되지 않는다(외래키)', async () => {
    const { order } = await orderWithCheckout(t)

    const code = await errorCodeOf("INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, returnable) VALUES ($1, 999, '없는 상품', 1000, 1, true)", [order.id])

    expect(code).toBe('23503') // foreign_key_violation
  })
})
