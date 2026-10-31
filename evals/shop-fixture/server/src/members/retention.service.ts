import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db } from '../db/db'

/**
 * 거래기록 파기 작업 — 탈퇴한 회원의 보존 기간(retain_until)이 지나면 주문·결제·환불·알림 기록을 복원할 수 없게 지운다.
 * 보존 기간 안에는 지우지 않는다(분쟁 때 증빙이다)
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** @returns 파기한 회원 수 */
  async purgeExpired() {
    const now = this.clock.now()
    const due = (await this.db.pool.query<{ user_id: string }>('SELECT user_id FROM withdrawals WHERE retain_until <= $1 AND purged_at IS NULL', [now])).rows
    for (const { user_id: userId } of due) {
      await this.db.transaction(async (tx) => {
        const orders = 'SELECT id FROM orders WHERE user_id = $1'
        await tx.query(`DELETE FROM returns WHERE order_id IN (${orders})`, [userId])
        await tx.query(`DELETE FROM refund_accounts WHERE order_id IN (${orders})`, [userId])
        await tx.query(`DELETE FROM payments WHERE order_id IN (${orders})`, [userId])
        await tx.query(`DELETE FROM order_items WHERE order_id IN (${orders})`, [userId])
        await tx.query('DELETE FROM notifications WHERE user_id = $1', [userId])
        await tx.query('DELETE FROM coupon_uses WHERE user_id = $1', [userId])
        await tx.query('DELETE FROM membership_charges WHERE user_id = $1', [userId])
        await tx.query('DELETE FROM orders WHERE user_id = $1', [userId])
        await tx.query('UPDATE withdrawals SET purged_at = $2 WHERE user_id = $1', [userId, now])
      })
    }
    return due.length
  }
}
