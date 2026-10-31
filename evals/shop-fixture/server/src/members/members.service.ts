import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db } from '../db/db'
import { fail } from '../http/errors'
import { ageOn, kstDate } from '../kst'

export interface SignUpInput {
  name?: unknown
  birthDate?: unknown
  agreements?: { terms?: unknown; privacy?: unknown; marketing?: unknown; nightMarketing?: unknown }
  guardianConsent?: unknown
}

// 만 14세 미만은 법정대리인 동의를 받는다
const GUARDIAN_AGE = 14
// 탈퇴해도 계약·결제·공급 기록은 거래한 때부터 5년 보존한다
export const RETAIN_YEARS = 5

@Injectable()
export class MembersService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** 가입 — 필수 동의(약관·개인정보)만 가입 조건이다. 광고 수신은 선택이라 거부해도 가입한다 */
  async signUp(input: SignUpInput) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) throw fail(400, 'INVALID_NAME', '이름이 필요하다')
    const birthDate = typeof input.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) ? input.birthDate : null
    // 2012-02-30처럼 달력에 없는 날은 Date가 다음 달로 넘긴다 — 돌려 본 값이 같아야 있는 날이다
    const real = birthDate !== null && new Date(`${birthDate}T00:00:00Z`).toISOString().slice(0, 10) === birthDate
    if (!birthDate || !real || birthDate > kstDate(this.clock.now())) throw fail(400, 'INVALID_BIRTH_DATE', '생년월일은 달력에 있는 YYYY-MM-DD다')
    const agreements = input.agreements ?? {}
    if (agreements.terms !== true || agreements.privacy !== true) throw fail(400, 'REQUIRED_CONSENT', '이용약관과 개인정보 수집·이용에 동의해야 가입할 수 있다')
    const now = this.clock.now()
    const child = ageOn(birthDate, now) < GUARDIAN_AGE
    if (child && input.guardianConsent !== true) throw fail(400, 'GUARDIAN_CONSENT_REQUIRED', '만 14세 미만은 법정대리인의 동의가 필요하다')
    const marketing = agreements.marketing === true
    // 야간 광고는 광고 수신에 동의한 사람에게만 따로 묻는다
    const nightMarketing = marketing && agreements.nightMarketing === true
    const id = await this.db.transaction(async (tx) => {
      const user = await tx.query<{ id: string }>("INSERT INTO users (id, name) VALUES (nextval('users_id_seq'), $1) RETURNING id", [name])
      const userId = Number(user.rows[0]?.id)
      await tx.query('INSERT INTO members (user_id, birth_date, joined_at, guardian_consented_at, marketing_at, night_marketing_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        userId,
        birthDate,
        now,
        child ? now : null,
        marketing ? now : null,
        nightMarketing ? now : null,
      ])
      return userId
    })
    return { id, name, marketing, nightMarketing }
  }

  /**
   * 탈퇴 — 회원 정보와 동의는 바로 지우고, 거래기록은 주문마다 주문한 때부터 5년 보존한 뒤 파기 작업(RetentionService)이 지운다.
   * retainUntil은 마지막 주문의 보존 기한이다(주문이 없으면 탈퇴한 때)
   */
  async withdraw(userId: number) {
    const now = this.clock.now()
    const last = (await this.db.pool.query<{ at: Date | null }>('SELECT max(created_at) AS at FROM orders WHERE user_id = $1', [userId])).rows[0]?.at ?? null
    const retainUntil = new Date(last ?? now)
    if (last) retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + RETAIN_YEARS)
    await this.db.transaction(async (tx) => {
      const inserted = await tx.query('INSERT INTO withdrawals (user_id, withdrawn_at, retain_until) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, now, retainUntil])
      if (inserted.rowCount !== 1) throw fail(409, 'ALREADY_WITHDRAWN', '이미 탈퇴했다')
      await tx.query('DELETE FROM members WHERE user_id = $1', [userId])
      await tx.query('DELETE FROM memberships WHERE user_id = $1', [userId])
      await tx.query('DELETE FROM membership_price_consents WHERE user_id = $1', [userId])
      await tx.query("UPDATE users SET name = '탈퇴한 회원', points = 0 WHERE id = $1", [userId])
    })
    return { withdrawnAt: now.toISOString(), retainUntil: retainUntil.toISOString() }
  }
}
