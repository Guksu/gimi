import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db } from '../db/db'
import { fail } from '../http/errors'

// 오른 요금은 청구일 전 30일 안에 받은 별도 동의로만 청구한다
const CONSENT_WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

const nextMonth = (at: Date) => {
  const next = new Date(at)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return next
}

/**
 * 멤버십 — 가입하면 첫 달을 청구하고 한 달마다 다시 청구한다.
 * 요금이 오르면 회원이 새 요금에 따로 동의해야 새 요금으로 청구한다. 동의가 없으면 종전 요금을 유지한다(가입 때 동의는 인상 동의가 아니다)
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async plan() {
    const row = (await this.db.pool.query<{ price: number }>('SELECT price FROM membership_plan WHERE id = 1')).rows[0]
    if (!row) throw fail(503, 'NO_PLAN', '멤버십 요금이 없다')
    return { price: row.price }
  }

  async join(userId: number) {
    const now = this.clock.now()
    const { price } = await this.plan()
    return this.db.transaction(async (tx) => {
      const inserted = await tx.query('INSERT INTO memberships (user_id, price, next_billing_at, joined_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [userId, price, nextMonth(now), now])
      if (inserted.rowCount !== 1) throw fail(409, 'ALREADY_MEMBER', '이미 멤버십에 가입했다')
      await tx.query('INSERT INTO membership_charges (user_id, amount, charged_at) VALUES ($1, $2, $3)', [userId, price, now])
      return { price, nextBillingAt: nextMonth(now).toISOString() }
    })
  }

  /** 청구일이 된 멤버십을 청구한다 — 정기 작업이 부른다. @returns 청구한 건수 */
  async billDue() {
    const now = this.clock.now()
    const { price: planPrice } = await this.plan()
    const due = (await this.db.pool.query<{ user_id: string; price: number; next_billing_at: Date }>('SELECT user_id, price, next_billing_at FROM memberships WHERE next_billing_at <= $1', [now])).rows
    for (const membership of due) {
      const userId = Number(membership.user_id)
      let amount = membership.price
      if (planPrice !== membership.price) {
        // 내린 요금은 동의 없이 쓴다. 오른 요금은 청구일 전 30일 안에 그 금액에 동의한 기록이 있어야 한다
        const since = new Date(membership.next_billing_at.getTime() - CONSENT_WINDOW_DAYS * DAY_MS)
        const consented = (await this.db.pool.query('SELECT 1 FROM membership_price_consents WHERE user_id = $1 AND price = $2 AND consented_at >= $3 AND consented_at <= $4', [userId, planPrice, since, membership.next_billing_at])).rowCount === 1
        if (planPrice < membership.price || consented) amount = planPrice
      }
      await this.db.transaction(async (tx) => {
        const moved = await tx.query('UPDATE memberships SET price = $2, next_billing_at = $3 WHERE user_id = $1 AND next_billing_at = $4', [userId, amount, nextMonth(membership.next_billing_at), membership.next_billing_at])
        if (moved.rowCount === 1) await tx.query('INSERT INTO membership_charges (user_id, amount, charged_at) VALUES ($1, $2, $3)', [userId, amount, now])
      })
    }
    return due.length
  }
}
