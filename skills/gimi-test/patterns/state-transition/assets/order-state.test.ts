import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canTransition, type OrderStatus } from '../src/orders/order-state'
import { KEYS, orderWithCheckout, startApp, type TestApp } from './helpers'

const STATUSES: OrderStatus[] = ['pending_payment', 'waiting_for_deposit', 'payment_failed', 'paid', 'preparing', 'shipped', 'delivered', 'partially_refunded', 'cancelled']

// 허용하는 전이 — 구현의 표를 가져오지 않고 요구사항에서 따로 옮겨 적는다(되돌아가는 전이 포함)
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'waiting_for_deposit', 'payment_failed', 'cancelled'],
  waiting_for_deposit: ['paid', 'payment_failed', 'cancelled'],
  payment_failed: ['paid', 'waiting_for_deposit', 'cancelled'], // 실패 뒤 승인
  paid: ['preparing', 'partially_refunded', 'cancelled'],
  partially_refunded: ['partially_refunded', 'preparing', 'cancelled'],
  preparing: ['shipped', 'partially_refunded', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}

// 모든 쌍 — 허용한 것만이 아니라 막아야 하는 쌍까지 하나씩 본다
const PAIRS = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to, ALLOWED[from].includes(to)] as const))

describe('주문 상태 전이표', () => {
  it.each(PAIRS)('%s → %s 허용: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed)
  })
})

describe('늦게 온 이벤트가 끝난 상태를 되돌리지 못한다', () => {
  let t: TestApp
  beforeEach(async () => {
    t = await startApp()
  })
  afterEach(async () => {
    await t.close()
  })

  const basic = (key: string) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`

  it('취소한 주문에 PG 승인이 늦게 와도 취소 그대로이고, 재고·포인트도 취소한 때 그대로다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t, { points: 1000 })
    expect((await t.as(1).post(`/orders/${order.id}/cancel`).send({})).body.status).toBe('cancelled')

    // 결제창에서 이미 승인이 진행 중이었다 — PG가 승인하고 웹훅을 보낸다
    await fetch(`${t.pg.url}/v1/payments/confirm`, {
      method: 'POST',
      headers: { authorization: basic(KEYS.secretKey), 'content-type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId: String(order.id), amount: order.total }),
    })
    await t.pg.flushWebhooks()

    expect((await t.as(1).get(`/orders/${order.id}`)).body.status).toBe('cancelled')
    const stock = (await t.db.query<{ stock: number }>('SELECT stock FROM products WHERE id = 1')).rows[0]?.stock
    const points = (await t.db.query<{ points: number }>('SELECT points FROM users WHERE id = 1')).rows[0]?.points
    expect({ stock, points }).toEqual({ stock: 20, points: 5000 })
  })
})
