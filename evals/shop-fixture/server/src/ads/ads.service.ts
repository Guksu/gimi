import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db } from '../db/db'
import { addYears, kstDate, kstHour } from '../kst'

export type AdChannel = 'push' | 'sms' | 'email'

// 야간 — 21시부터 다음 날 8시 전까지(한국 시간). 이메일은 야간 규정의 예외다
const NIGHT_FROM = 21
const NIGHT_UNTIL = 8
// 수신 동의는 동의한 날부터 2년마다 다시 확인한다 — 2년이 되는 날 전까지만 쓴다
const RECONFIRM_YEARS = 2

/** 동의가 아직 쓸 수 있는지 — 동의한 날(한국 날짜)에서 2년이 되는 날 전까지 */
const stillValid = (consentedAt: Date | null, now: Date) => consentedAt !== null && kstDate(now) < addYears(kstDate(consentedAt), RECONFIRM_YEARS)

/**
 * 광고 발송 대상 — 발송기는 이 목록에만 보낸다. 광고 수신 동의, 야간 별도 동의, 2년 재확인을 본다
 */
@Injectable()
export class AdsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async recipients(channel: AdChannel) {
    const now = this.clock.now()
    const hour = kstHour(now)
    const night = channel !== 'email' && (hour >= NIGHT_FROM || hour < NIGHT_UNTIL)
    const rows = (await this.db.pool.query<{ user_id: string; marketing_at: Date | null; night_marketing_at: Date | null }>('SELECT user_id, marketing_at, night_marketing_at FROM members ORDER BY user_id')).rows
    return rows.filter((row) => stillValid(row.marketing_at, now) && (!night || stillValid(row.night_marketing_at, now))).map((row) => Number(row.user_id))
  }
}
