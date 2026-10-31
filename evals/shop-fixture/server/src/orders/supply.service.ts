import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db } from '../db/db'
import { fail } from '../http/errors'
import { OrdersService } from './orders.service'

/**
 * 공급 불가 — 결제한 주문을 보낼 수 없게 되면(품절·단종) 손님에게 바로 알리고 결제한 금액을 바로 환불한다.
 * 법은 3영업일 안에 환급하라고 한다. 기다릴 이유가 없어 알림과 함께 취소한다
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
    const userId = Number(order.user_id)
    await this.db.pool.query('INSERT INTO notifications (user_id, order_id, kind, message, sent_at) VALUES ($1, $2, $3, $4, $5)', [
      userId,
      orderId,
      'supply_failed',
      `주문하신 상품을 보낼 수 없게 됐어요(${reason}). 결제한 금액은 바로 환불해 드려요`,
      this.clock.now(),
    ])
    return this.orders.cancel(userId, orderId, { reason: `공급 불가 — ${reason}` })
  }
}
