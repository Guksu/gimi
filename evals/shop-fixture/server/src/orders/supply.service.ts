import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db } from '../db/db'
import { fail } from '../http/errors'
import { OrdersService } from './orders.service'

// 보내기 전이라 취소할 수 있는 주문
const UNSHIPPED = ['pending_payment', 'waiting_for_deposit', 'payment_failed', 'paid', 'preparing', 'partially_refunded']
// 결제가 끝나 돌려줄 돈이 있는 주문
const PAID = ['paid', 'preparing', 'partially_refunded']

/**
 * 공급 불가 — 주문을 보낼 수 없게 되면(품절·단종) 취소하고 결제한 금액을 바로 환불한 뒤 손님에게 알린다.
 * 법은 지체 없이 알리고 3영업일 안에 환급하라고 한다. 기다릴 이유가 없어 바로 취소한다. 환불이 실패하면 알리지 않고 오류를 내고, 작업이 다시 부른다
 */
@Injectable()
export class SupplyService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly orders: OrdersService,
  ) {}

  async markUnavailable(orderId: number, reason: string) {
    const order = (await this.db.pool.query<{ user_id: string; status: string }>('SELECT user_id, status FROM orders WHERE id = $1', [orderId])).rows[0]
    if (!order) throw fail(404, 'ORDER_NOT_FOUND', '주문이 없다')
    if (!UNSHIPPED.includes(order.status)) throw fail(409, 'NOT_CANCELABLE', '이미 보냈거나 취소한 주문이다')
    const userId = Number(order.user_id)
    const cancelled = await this.orders.cancel(userId, orderId, { reason: `공급 불가 — ${reason}` })
    // 취소가 되돌린 재고는 보낼 수 없는 재고다 — 그 상품은 품절로 둔다
    await this.db.pool.query('UPDATE products SET stock = 0 WHERE id IN (SELECT product_id FROM order_items WHERE order_id = $1)', [orderId])
    const refund = PAID.includes(order.status) ? ' 결제한 금액은 환불했어요' : ''
    await this.db.pool.query('INSERT INTO notifications (user_id, order_id, kind, message, sent_at) VALUES ($1, $2, $3, $4, $5)', [
      userId,
      orderId,
      'supply_failed',
      `주문하신 상품을 보낼 수 없게 되어 주문을 취소했어요(${reason}).${refund}`,
      this.clock.now(),
    ])
    return cancelled
  }
}
