import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db } from '../db/db'
import { fail } from '../http/errors'
import { pointsToEarn } from '../money'
import { canTransition, transition, type OrderStatus } from '../orders/order-state'
import { OrdersService, type OrderRow } from '../orders/orders.service'
import { PgClient, PgError, PgUnavailable, type PgPayment } from './pg-client'

// PG 상태 → 주문 상태. 여기 없는 값은 모르는 값이다 — 주문을 바꾸지 않고 보류로 기록한다
const PG_TO_ORDER: Readonly<Record<string, OrderStatus>> = {
  DONE: 'paid',
  WAITING_FOR_DEPOSIT: 'waiting_for_deposit',
  ABORTED: 'payment_failed',
  PARTIAL_CANCELED: 'partially_refunded',
  CANCELED: 'cancelled',
}

export type ApplyResult = 'applied' | 'unchanged' | `held:${string}`

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: Db,
    private readonly orders: OrdersService,
    private readonly pg: PgClient,
    private readonly clock: Clock,
  ) {}

  /**
   * 결제 확정 — 결제창에서 돌아온 금액이 저장한 금액과 같을 때만 PG에 승인을 받는다(PG에는 저장한 금액을 보낸다).
   * 승인 결과를 모르면(시간 초과·PG 오류) 실패로 단정하지 않고 PG에 조회한다. 여러 번·동시에 불려도 한 번만 반영한다
   */
  async confirm(userId: number, input: { orderId?: unknown; paymentKey?: unknown; amount?: unknown }) {
    const orderId = Number(input.orderId)
    const order = await this.orders.row(userId, orderId)
    if (typeof input.paymentKey !== 'string' || !input.paymentKey) throw fail(400, 'INVALID_REQUEST', 'paymentKey가 없다')
    const paymentKey = input.paymentKey
    if (input.amount !== order.total) throw fail(400, 'AMOUNT_MISMATCH', '결제 금액이 주문 금액과 다르다')
    if (['paid', 'waiting_for_deposit'].includes(order.status)) {
      const recorded = await this.db.pool.query('SELECT 1 FROM payments WHERE payment_key = $1 AND order_id = $2', [paymentKey, orderId])
      if ((recorded.rowCount ?? 0) > 0) return { status: 200, body: await this.orders.get(userId, orderId) }
    }
    if (!['pending_payment', 'payment_failed'].includes(order.status)) throw fail(409, 'NOT_PAYABLE', '결제할 수 있는 주문이 아니다')

    let payment: PgPayment | null
    try {
      payment = await this.pg.confirm({ paymentKey, orderId: String(order.id), amount: order.total })
    } catch (error) {
      const uncertain = error instanceof PgUnavailable || (error instanceof PgError && (error.status >= 500 || error.code === 'ALREADY_PROCESSED_PAYMENT'))
      if (!uncertain) {
        // 확실한 거절 — 결제 실패로 두고 다시 결제할 수 있게 한다
        await transition(this.db.pool, orderId, order.status, 'payment_failed')
        throw fail(402, 'PAYMENT_REJECTED', error instanceof PgError ? `${error.code} ${error.message}`.trim() : '결제가 거절됐다')
      }
      payment = await this.pg.lookup(paymentKey).catch(() => null)
      if (!payment) return { status: 202, body: { status: 'checking', message: '결제 결과를 확인하고 있다 — 잠시 뒤 주문 내역에서 확인한다' } }
      if (payment.status === 'READY') throw fail(502, 'PG_UNAVAILABLE', '결제가 승인되지 않았다 — 다시 시도한다')
    }
    await this.apply(order, payment)
    return { status: 200, body: await this.orders.get(userId, orderId) }
  }

  /** 웹훅 — 본문을 믿지 않고 PG에 조회한 결제로 주문을 맞춘다 */
  async syncFromPg(paymentKey: string): Promise<ApplyResult> {
    const payment = await this.pg.lookup(paymentKey)
    const order = (await this.db.pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [Number(payment.orderId)])).rows[0]
    if (!order) return `held:UNKNOWN_ORDER`
    return this.apply(order, payment)
  }

  /** PG의 지금 상태를 주문에 반영한다 — 결제 기록은 결제 키로 하나, 상태는 전이표가 허락할 때만, 포인트 적립은 결제 완료로 바뀔 때 한 번 */
  private async apply(order: OrderRow, payment: PgPayment): Promise<ApplyResult> {
    const target = PG_TO_ORDER[payment.status]
    if (!target) return `held:${payment.status}`
    return this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO payments (payment_key, order_id, method, amount, pg_status, approved_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (payment_key) DO UPDATE SET pg_status = EXCLUDED.pg_status, approved_at = COALESCE(EXCLUDED.approved_at, payments.approved_at)`,
        [payment.paymentKey, order.id, payment.method, payment.totalAmount, payment.status, payment.approvedAt],
      )
      const current = (await tx.query<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = $1', [order.id])).rows[0]?.status
      if (!current || current === target || !canTransition(current, target)) return 'unchanged'
      const earned = target === 'paid' ? pointsToEarn(order.total) : 0
      const set = target === 'paid' ? { paid_at: this.clock.now(), points_earned: earned } : {}
      if (!(await transition(tx, Number(order.id), current, target, set))) return 'unchanged'
      if (earned > 0) await tx.query('UPDATE users SET points = points + $2 WHERE id = $1', [order.user_id, earned])
      return 'applied'
    })
  }
}
