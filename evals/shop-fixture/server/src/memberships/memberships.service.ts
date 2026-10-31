import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db } from '../db/db'
import { fail } from '../http/errors'
import { addMonthsKst, kstDay } from '../kst'

// 오른 요금은 청구일 전 30일 안에 받은 별도 동의로만 청구한다
const CONSENT_WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** 다음 청구일 — 가입한 날(한국 날짜)과 같은 날, 그달에 없으면 그달 마지막 날 */
const nextBilling = (from: Date, joinedAt: Date) => addMonthsKst(from, 1, kstDay(joinedAt))

/**
 * 멤버십 — 가입하면 첫 달을 청구하고 한 달마다 다시 청구한다. 해지는 가입처럼 요청 한 번이다.
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
      const next = nextBilling(now, now)
      const inserted = await tx.query('INSERT INTO memberships (user_id, price, next_billing_at, joined_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [userId, price, next, now])
      if (inserted.rowCount !== 1) throw fail(409, 'ALREADY_MEMBER', '이미 멤버십에 가입했다')
      await tx.query('INSERT INTO membership_charges (user_id, amount, charged_at) VALUES ($1, $2, $3)', [userId, price, now])
      return { price, nextBillingAt: next.toISOString() }
    })
  }

  /** 해지 — 다음 청구일부터 청구하지 않는다 */
  async cancel(userId: number) {
    const removed = await this.db.pool.query('DELETE FROM memberships WHERE user_id = $1', [userId])
    if (removed.rowCount !== 1) throw fail(404, 'NOT_MEMBER', '멤버십에 가입하지 않았다')
    return { cancelledAt: this.clock.now().toISOString() }
  }

  /** 오른 요금에 대한 별도 동의 — 지금 요금표의 금액이 회원의 금액보다 높을 때만 받는다 */
  async consentToPrice(userId: number) {
    const now = this.clock.now()
    const { price } = await this.plan()
    const membership = (await this.db.pool.query<{ price: number }>('SELECT price FROM memberships WHERE user_id = $1', [userId])).rows[0]
    if (!membership) throw fail(404, 'NOT_MEMBER', '멤버십에 가입하지 않았다')
    if (price <= membership.price) throw fail(409, 'NO_PRICE_INCREASE', '오른 요금이 없다')
    await this.db.pool.query(
      `INSERT INTO membership_price_consents (user_id, price, from_price, consented_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, price) DO UPDATE SET from_price = EXCLUDED.from_price, consented_at = EXCLUDED.consented_at`,
      [userId, price, membership.price, now],
    )
    return { fromPrice: membership.price, price, consentedAt: now.toISOString() }
  }

  /** 청구일이 된 멤버십을 청구한다 — 정기 작업이 부른다. @returns 청구한 건수(그 사이 다른 작업이 먼저 청구했으면 세지 않는다) */
  async billDue() {
    const now = this.clock.now()
    const { price: planPrice } = await this.plan()
    const due = (await this.db.pool.query<{ user_id: string; price: number; next_billing_at: Date; joined_at: Date }>('SELECT user_id, price, next_billing_at, joined_at FROM memberships WHERE next_billing_at <= $1', [now])).rows
    let charged = 0
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
        const moved = await tx.query('UPDATE memberships SET price = $2, next_billing_at = $3 WHERE user_id = $1 AND next_billing_at = $4', [userId, amount, nextBilling(membership.next_billing_at, membership.joined_at), membership.next_billing_at])
        if (moved.rowCount !== 1) return
        await tx.query('INSERT INTO membership_charges (user_id, amount, charged_at) VALUES ($1, $2, $3)', [userId, amount, now])
        charged += 1
      })
    }
    return charged
  }
}
