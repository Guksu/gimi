import { Injectable } from '@nestjs/common'
import type { PoolClient } from 'pg'
import { AppConfig } from '../config'
import { Clock } from '../clock'
import { Db, isUniqueViolation, type Queryable } from '../db/db'
import { fail } from '../http/errors'
import type { Method } from '../money'
import { PgClient, PgError, PgUnavailable } from '../payments/pg-client'
import { PricingService, type QuoteInput } from '../pricing/pricing.service'
import { transition, type OrderStatus } from './order-state'
import { CHANGE_OF_MIND_DAYS, DEFECTIVE_DAYS, returnDeadline } from './returns-policy'

export interface OrderRow {
  id: string
  user_id: string
  status: OrderStatus
  method: Method
  subtotal: number
  coupon_code: string | null
  coupon_discount: number
  points_used: number
  shipping_fee: number
  total: number
  points_earned: number
  refunded_amount: number
  created_at: Date
  paid_at: Date | null
  delivered_at: Date | null
}

interface ItemRow {
  product_id: string
  name: string
  unit_price: number
  quantity: number
  returnable: boolean
}

// 화면에 취소 버튼을 보일 수 있는 상태 — 배송을 시작하면 취소가 아니라 반품이다
const CANCELABLE: ReadonlySet<OrderStatus> = new Set(['pending_payment', 'payment_failed', 'waiting_for_deposit', 'paid', 'preparing', 'partially_refunded'])
const REFUNDABLE: ReadonlySet<OrderStatus> = new Set(['paid', 'preparing', 'partially_refunded'])
const PAYABLE: ReadonlySet<OrderStatus> = new Set(['pending_payment', 'payment_failed'])

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: Db,
    private readonly pricing: PricingService,
    private readonly clock: Clock,
    private readonly pg: PgClient,
    private readonly config: AppConfig,
  ) {}

  /** 주문 만들기 — 금액은 서버가 다시 계산한다. 재고·쿠폰·포인트는 확인과 차감을 조건부 UPDATE 하나로 한다 */
  async create(userId: number, idempotencyKey: string | undefined, input: QuoteInput) {
    if (!idempotencyKey) throw fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 머리가 필요하다')
    const existing = await this.findIdByKey(userId, idempotencyKey)
    if (existing) return { order: await this.get(userId, existing), created: false }
    let id: number
    try {
      id = await this.db.transaction(async (tx) => {
        const quote = await this.pricing.quote(userId, input, tx)
        for (const line of quote.lines) {
          const taken = await tx.query('UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2', [line.productId, line.quantity])
          if (taken.rowCount !== 1) throw fail(409, 'OUT_OF_STOCK', `${line.name}의 재고가 모자라다`)
        }
        if (quote.couponCode) {
          const used = await tx.query('UPDATE coupons SET used_count = used_count + 1 WHERE code = $1 AND used_count < max_uses', [quote.couponCode])
          if (used.rowCount !== 1) throw fail(409, 'COUPON_EXHAUSTED', '쿠폰이 모두 쓰였다')
        }
        if (quote.pointsUsed > 0) {
          const spent = await tx.query('UPDATE users SET points = points - $2 WHERE id = $1 AND points >= $2', [userId, quote.pointsUsed])
          if (spent.rowCount !== 1) throw fail(409, 'POINTS_EXCEED_BALANCE', '보유 포인트가 모자라다')
        }
        // 0원 주문은 PG 없이 확정한다
        const free = quote.total === 0
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO orders (user_id, idempotency_key, status, method, subtotal, coupon_code, coupon_discount, points_used, shipping_fee, total, paid_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [userId, idempotencyKey, free ? 'paid' : 'pending_payment', quote.method, quote.subtotal, quote.couponCode, quote.couponDiscount, quote.pointsUsed, quote.shippingFee, quote.total, free ? this.clock.now() : null],
        )
        const orderId = Number(inserted.rows[0]?.id)
        if (quote.couponCode) await tx.query('INSERT INTO coupon_uses (coupon_code, user_id, order_id) VALUES ($1, $2, $3)', [quote.couponCode, userId, orderId])
        for (const line of quote.lines) {
          await tx.query('INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, returnable) VALUES ($1, $2, $3, $4, $5, $6)', [orderId, line.productId, line.name, line.unitPrice, line.quantity, line.returnable])
        }
        return orderId
      })
    } catch (error) {
      // 같은 멱등 키가 동시에 들어오면 유니크 제약이 하나만 남긴다 — 남은 주문을 돌려준다
      if (isUniqueViolation(error, 'orders_user_id_idempotency_key_key')) {
        const winner = await this.findIdByKey(userId, idempotencyKey)
        if (winner) return { order: await this.get(userId, winner), created: false }
      }
      if (isUniqueViolation(error, 'coupon_uses_pkey')) throw fail(409, 'COUPON_ALREADY_USED', '이미 쓴 쿠폰이다')
      throw error
    }
    return { order: await this.get(userId, id), created: true }
  }

  private async findIdByKey(userId: number, key: string) {
    const row = (await this.db.pool.query<{ id: string }>('SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2', [userId, key])).rows[0]
    return row ? Number(row.id) : null
  }

  /** 내 주문 — 남의 주문은 없는 것과 같다(404) */
  async row(userId: number, orderId: number, q: Queryable = this.db.pool) {
    if (!Number.isSafeInteger(orderId)) throw fail(404, 'ORDER_NOT_FOUND', '주문이 없다')
    const order = (await q.query<OrderRow>('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId])).rows[0]
    if (!order) throw fail(404, 'ORDER_NOT_FOUND', '주문이 없다')
    return order
  }

  async get(userId: number, orderId: number) {
    const order = await this.row(userId, orderId)
    const items = (await this.db.pool.query<ItemRow>('SELECT product_id, name, unit_price, quantity, returnable FROM order_items WHERE order_id = $1 ORDER BY product_id', [orderId])).rows
    return this.view(order, items)
  }

  async list(userId: number) {
    const rows = (await this.db.pool.query<OrderRow>('SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC', [userId])).rows
    return { items: rows.map((order) => ({ id: Number(order.id), status: order.status, total: order.total, createdAt: order.created_at.toISOString() })) }
  }

  /** 화면이 쓸 값 — 취소·반품 가능 여부와 기한은 서버가 정해 준다 */
  view(order: OrderRow, items: ItemRow[]) {
    const now = this.clock.now()
    const deadline = order.delivered_at ? returnDeadline(order.delivered_at) : null
    const refundable = REFUNDABLE.has(order.status) ? order.total - order.refunded_amount : 0
    return {
      id: Number(order.id),
      status: order.status,
      method: order.method,
      items: items.map((item) => ({ productId: Number(item.product_id), name: item.name, unitPrice: item.unit_price, quantity: item.quantity, returnable: item.returnable })),
      subtotal: order.subtotal,
      couponDiscount: order.coupon_discount,
      pointsUsed: order.points_used,
      shippingFee: order.shipping_fee,
      total: order.total,
      pointsEarned: order.points_earned,
      refundedAmount: order.refunded_amount,
      refundableAmount: refundable,
      canCancel: CANCELABLE.has(order.status),
      canReturn: order.status === 'delivered' && deadline !== null && now < deadline && items.some((item) => item.returnable),
      returnDeadline: deadline?.toISOString() ?? null,
      createdAt: order.created_at.toISOString(),
      paidAt: order.paid_at?.toISOString() ?? null,
      deliveredAt: order.delivered_at?.toISOString() ?? null,
    }
  }

  /** 결제창 — 금액은 저장한 주문 금액이다 */
  async checkout(userId: number, orderId: number) {
    const order = await this.row(userId, orderId)
    if (!PAYABLE.has(order.status) || order.total === 0) throw fail(409, 'NOT_PAYABLE', '결제할 수 있는 주문이 아니다')
    try {
      return await this.pg.createCheckout({
        orderId: String(order.id),
        amount: order.total,
        method: order.method,
        successUrl: `${this.config.webBaseUrl}/payments/success`,
        failUrl: `${this.config.webBaseUrl}/payments/fail`,
      })
    } catch (error) {
      if (error instanceof PgError && error.status < 500) throw fail(400, error.code, error.message)
      throw fail(502, 'PG_UNAVAILABLE', '결제창을 열지 못했다 — 잠시 뒤 다시 시도한다')
    }
  }

  /** 취소·환불 — 부분 취소는 서버가 아는 남은 금액을 PG에 검증값으로 보낸다. PG 호출은 트랜잭션 밖에서 한다 */
  async cancel(userId: number, orderId: number, input: { amount?: unknown; reason?: unknown }) {
    const order = await this.row(userId, orderId)
    if (!CANCELABLE.has(order.status)) throw fail(409, 'NOT_CANCELABLE', '취소할 수 없는 주문이다 — 배송을 시작했으면 반품을 신청한다')
    const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : '고객 요청'

    // 결제 전·실패 — PG에 돈이 없다
    if (order.status === 'pending_payment' || order.status === 'payment_failed') {
      await this.db.transaction(async (tx) => {
        if (await transition(tx, orderId, order.status, 'cancelled')) await this.release(tx, order)
      })
      return this.get(userId, orderId)
    }

    const payment = (await this.db.pool.query<{ payment_key: string }>('SELECT payment_key FROM payments WHERE order_id = $1', [orderId])).rows[0]
    if (!payment) throw fail(409, 'NOT_CANCELABLE', '결제 기록이 없다')

    // 입금 전 가상계좌 — 환불할 돈이 없다. 발급한 계좌만 닫는다
    if (order.status === 'waiting_for_deposit') {
      await this.callPg(() => this.pg.cancel(payment.payment_key, { cancelReason: reason }))
      await this.db.transaction(async (tx) => {
        if (await transition(tx, orderId, 'waiting_for_deposit', 'cancelled')) await this.release(tx, order)
      })
      return this.get(userId, orderId)
    }

    const refundable = order.total - order.refunded_amount
    const amount = input.amount ?? refundable
    if (!Number.isSafeInteger(amount) || (amount as number) <= 0) throw fail(400, 'INVALID_AMOUNT', '취소 금액은 양의 정수다')
    if ((amount as number) > refundable) throw fail(400, 'EXCEED_REFUNDABLE', `남은 금액은 ${refundable}원이다`)
    await this.callPg(() => this.pg.cancel(payment.payment_key, { cancelAmount: amount as number, refundableAmount: refundable, cancelReason: reason }))
    await this.db.transaction(async (tx) => {
      const full = (amount as number) === refundable
      const updated = await tx.query(
        'UPDATE orders SET refunded_amount = refunded_amount + $2, status = $3 WHERE id = $1 AND refunded_amount + $2 <= total AND status = ANY($4::text[])',
        [orderId, amount, full ? 'cancelled' : 'partially_refunded', [...REFUNDABLE]],
      )
      if (updated.rowCount === 1 && full) await this.release(tx, order)
    })
    return this.get(userId, orderId)
  }

  private async callPg<T>(fn: () => Promise<T>) {
    try {
      return await fn()
    } catch (error) {
      if (error instanceof PgError && error.status < 500) throw fail(400, 'REFUND_REJECTED', `PG가 취소를 거절했다(${error.code}) — 주문을 다시 불러와 남은 금액을 확인한다`)
      if (error instanceof PgError || error instanceof PgUnavailable) throw fail(502, 'PG_UNAVAILABLE', '취소 결과를 받지 못했다 — 잠시 뒤 주문 상태를 다시 확인한다')
      throw error
    }
  }

  /** 주문을 취소하면 묶어 둔 재고·쿠폰·포인트를 돌려주고, 적립한 포인트를 거둔다 */
  private async release(tx: PoolClient, order: OrderRow) {
    await tx.query('UPDATE products p SET stock = p.stock + i.quantity FROM order_items i WHERE i.order_id = $1 AND p.id = i.product_id', [order.id])
    if (order.coupon_code) {
      await tx.query('UPDATE coupons SET used_count = used_count - 1 WHERE code = $1 AND used_count > 0', [order.coupon_code])
      await tx.query('DELETE FROM coupon_uses WHERE coupon_code = $1 AND order_id = $2', [order.coupon_code, order.id])
    }
    const back = order.points_used - order.points_earned
    if (back !== 0) await tx.query('UPDATE users SET points = GREATEST(points + $2, 0) WHERE id = $1', [order.user_id, back])
  }

  /** 반품(청약철회) — 배송 완료 뒤 기한 안에. 반품 불가로 표시한 상품은 단순 변심으로 받지 않는다 */
  async requestReturn(userId: number, orderId: number, input: { reason?: unknown }) {
    const order = await this.row(userId, orderId)
    const reason = input.reason
    if (reason !== 'change_of_mind' && reason !== 'defective') throw fail(400, 'INVALID_REASON', '사유는 change_of_mind·defective 중 하나다')
    if (order.status !== 'delivered' || !order.delivered_at) throw fail(409, 'NOT_DELIVERED', '배송이 끝나기 전에는 주문을 취소한다')
    const deadline = returnDeadline(order.delivered_at, reason === 'defective' ? DEFECTIVE_DAYS : CHANGE_OF_MIND_DAYS)
    const now = this.clock.now()
    if (now >= deadline) throw fail(409, 'RETURN_WINDOW_CLOSED', '반품 기한이 지났다')
    if (reason === 'change_of_mind') {
      const items = (await this.db.pool.query<{ returnable: boolean }>('SELECT returnable FROM order_items WHERE order_id = $1', [orderId])).rows
      if (!items.some((item) => item.returnable)) throw fail(409, 'NOT_RETURNABLE', '단순 변심으로 반품할 수 없다고 표시한 상품이다')
    }
    const inserted = await this.db.pool.query<{ id: string }>('INSERT INTO returns (order_id, reason, requested_at) VALUES ($1, $2, $3) RETURNING id', [orderId, reason, now])
    return { id: Number(inserted.rows[0]?.id), deadline: deadline.toISOString() }
  }
}
