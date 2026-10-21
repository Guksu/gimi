/**
 * 주문 상태 전이표 — 상태는 이 표에 있는 전이로만 바꾼다(transition). 되돌아가는 전이도 표에 둔다
 */
import type { Queryable } from '../db/db'

export type OrderStatus = 'pending_payment' | 'waiting_for_deposit' | 'payment_failed' | 'paid' | 'preparing' | 'shipped' | 'delivered' | 'partially_refunded' | 'cancelled'

export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'waiting_for_deposit', 'payment_failed', 'cancelled'],
  waiting_for_deposit: ['paid', 'payment_failed', 'cancelled'],
  // 실패 뒤 승인 — PG 조회·웹훅이 승인을 알려 오면 결제 완료로 되돌아간다
  payment_failed: ['paid', 'waiting_for_deposit', 'cancelled'],
  paid: ['preparing', 'partially_refunded', 'cancelled'],
  partially_refunded: ['partially_refunded', 'preparing', 'cancelled'],
  preparing: ['shipped', 'partially_refunded', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}

export const canTransition = (from: OrderStatus, to: OrderStatus) => TRANSITIONS[from]?.includes(to) ?? false

/**
 * 조건부 전이 — 지금 상태가 from일 때만 바꾼다. 동시에 다른 요청이 먼저 바꿨으면 false
 * @param set 함께 바꿀 열(예: paid_at)
 */
export const transition = async (q: Queryable, orderId: number, from: OrderStatus, to: OrderStatus, set: Record<string, unknown> = {}) => {
  if (!canTransition(from, to)) return false
  const columns = Object.keys(set)
  const assignments = ['status = $3', ...columns.map((column, i) => `${column} = $${i + 4}`)].join(', ')
  const result = await q.query(`UPDATE orders SET ${assignments} WHERE id = $1 AND status = $2`, [orderId, from, to, ...columns.map((column) => set[column])])
  return result.rowCount === 1
}
