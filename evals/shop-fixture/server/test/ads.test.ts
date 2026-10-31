import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AdsService } from '../src/ads/ads.service'
import { startApp, type TestApp } from './helpers'

let t: TestApp
let ads: AdsService
beforeEach(async () => {
  t = await startApp()
  ads = t.app.get(AdsService)
  // 1번은 광고 수신만, 2번은 야간 광고까지 동의했다
  await t.db.query(`INSERT INTO members (user_id, birth_date, joined_at, marketing_at, night_marketing_at) VALUES
    (1, '1990-05-01', '2026-01-10T03:00:00Z', '2026-01-10T03:00:00Z', NULL),
    (2, '1990-05-01', '2026-01-10T03:00:00Z', '2026-01-10T03:00:00Z', '2026-01-10T03:00:00Z')`)
})
afterEach(async () => {
  await t.close()
})

describe('광고 발송 대상', () => {
  it('야간(21시~다음 날 8시, 한국 시간)에는 야간 광고에 따로 동의한 사람에게만 보낸다', async () => {
    const at = async (iso: string) => {
      t.clock.set(iso)
      return ads.recipients('push')
    }
    expect(await at('2026-10-21T11:59:00Z')).toEqual([1, 2]) // 20:59
    expect(await at('2026-10-21T12:00:00Z')).toEqual([2]) // 21:00
    expect(await at('2026-10-21T22:59:00Z')).toEqual([2]) // 다음 날 07:59
    expect(await at('2026-10-21T23:00:00Z')).toEqual([1, 2]) // 다음 날 08:00
  })

  it('이메일은 야간에도 광고 수신 동의만 본다', async () => {
    t.clock.set('2026-10-21T13:00:00Z')
    expect(await ads.recipients('email')).toEqual([1, 2])
  })

  it('수신 동의는 동의한 날부터 2년이 되는 날 전까지만 쓴다 — 그 뒤에는 다시 확인해야 한다', async () => {
    await t.db.query("UPDATE members SET marketing_at = '2024-10-21T03:00:00Z' WHERE user_id = 1")
    t.clock.set('2026-10-20T03:00:00Z')
    expect(await ads.recipients('email')).toEqual([1, 2])
    t.clock.set('2026-10-21T03:00:00Z')
    expect(await ads.recipients('email')).toEqual([2])
  })

  it('2년은 한국 날짜로 센다 — 한국 날짜가 바뀌는 UTC 15시가 경계다', async () => {
    await t.db.query("UPDATE members SET marketing_at = '2024-10-21T15:30:00Z' WHERE user_id = 1") // 한국 날짜 2024-10-22
    t.clock.set('2026-10-21T14:59:00Z') // 한국 2026-10-21 23:59
    expect(await ads.recipients('email')).toEqual([1, 2])
    t.clock.set('2026-10-21T15:00:00Z') // 한국 2026-10-22 00:00
    expect(await ads.recipients('email')).toEqual([2])
  })

  it('광고 수신에 동의하지 않았거나 탈퇴한 사람에게는 보내지 않는다', async () => {
    await t.db.query('UPDATE members SET marketing_at = NULL WHERE user_id = 2')
    await t.as(1).post('/members/me/withdraw')
    expect(await ads.recipients('email')).toEqual([])
  })
})
