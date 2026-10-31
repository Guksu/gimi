import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db } from '../db/db'
import { RETAIN_YEARS } from './members.service'

/**
 * 거래기록 파기 작업 — 탈퇴한 회원의 주문은 주문한 때부터 5년이 지나면 주문·결제·환불·알림 기록을 복원할 수 없게 지운다.
 * 보존 기간 안에는 지우지 않는다(분쟁 때 증빙이다). 정기 작업이 부른다
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** @returns 파기한 주문 수 */
  async purgeExpired() {
    const now = this.clock.now()
    const before = new Date(now)
    before.setUTCFullYear(before.getUTCFullYear() - RETAIN_YEARS)
    return this.db.transaction(async (tx) => {
      const expired = `SELECT o.id FROM orders o JOIN withdrawals w ON w.user_id = o.user_id WHERE o.created_at <= $1`
      await tx.query(`DELETE FROM returns WHERE order_id IN (${expired})`, [before])
      await tx.query(`DELETE FROM refund_accounts WHERE order_id IN (${expired})`, [before])
      await tx.query(`DELETE FROM payments WHERE order_id IN (${expired})`, [before])
      await tx.query(`DELETE FROM order_items WHERE order_id IN (${expired})`, [before])
      await tx.query(`DELETE FROM notifications WHERE order_id IN (${expired})`, [before])
      await tx.query(`DELETE FROM coupon_uses WHERE order_id IN (${expired})`, [before])
      await tx.query('DELETE FROM membership_charges c USING withdrawals w WHERE w.user_id = c.user_id AND c.charged_at <= $1', [before])
      const purged = await tx.query(`DELETE FROM orders WHERE id IN (${expired})`, [before])
      // 남은 주문이 없으면 그 회원의 파기를 끝낸다
      await tx.query('UPDATE withdrawals w SET purged_at = $1 WHERE purged_at IS NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = w.user_id)', [now])
      return purged.rowCount ?? 0
    })
  }
}
