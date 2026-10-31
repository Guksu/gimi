import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RetentionService } from '../src/members/retention.service'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

// 가입은 로그인 전이다 — x-user-id는 보지 않는다
const signUp = (body: Record<string, unknown> = {}) =>
  t
    .as(1)
    .post('/members')
    .send({ name: '새 손님', birthDate: '1990-05-01', agreements: { terms: true, privacy: true, marketing: false, nightMarketing: false }, ...body })
const memberRow = async (id: number) => (await t.db.query('SELECT * FROM members WHERE user_id = $1', [id])).rows[0]

describe('POST /members — 가입과 동의', () => {
  it('필수 동의(약관·개인정보)만으로 가입된다 — 광고 수신은 선택이라 거부해도 가입한다', async () => {
    const res = await signUp()
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: '새 손님', marketing: false, nightMarketing: false })
    expect(await memberRow(res.body.id)).toMatchObject({ marketing_at: null, night_marketing_at: null })
  })

  it('필수 동의가 빠지면 가입하지 않는다', async () => {
    const res = await signUp({ agreements: { terms: true, privacy: false, marketing: true } })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('REQUIRED_CONSENT')
  })

  it('광고 수신·야간 광고에 동의하면 동의한 때를 남긴다(2년마다 다시 확인하는 기준)', async () => {
    const res = await signUp({ agreements: { terms: true, privacy: true, marketing: true, nightMarketing: true } })
    expect(res.status).toBe(201)
    const row = await memberRow(res.body.id)
    expect(row.marketing_at.toISOString()).toBe('2026-10-21T03:00:00.000Z')
    expect(row.night_marketing_at.toISOString()).toBe('2026-10-21T03:00:00.000Z')
  })

  it('만 14세 미만은 법정대리인 동의가 있어야 가입된다 — 14세 생일(한국 날짜) 전날까지가 14세 미만이다', async () => {
    // 지금은 2026-10-21 12:00(한국 시간)
    const dayBefore = await signUp({ birthDate: '2012-10-22' })
    expect(dayBefore.status).toBe(400)
    expect(dayBefore.body.code).toBe('GUARDIAN_CONSENT_REQUIRED')
    expect((await signUp({ birthDate: '2012-10-22', guardianConsent: true })).status).toBe(201)
    expect((await signUp({ birthDate: '2012-10-21' })).status).toBe(201)
  })
})

describe('POST /members/me/withdraw — 탈퇴와 거래기록 보존', () => {
  it('탈퇴하면 회원 정보와 동의는 바로 지우고, 주문 기록은 5년 보존한 뒤 파기한다', async () => {
    await t.db.query("INSERT INTO members (user_id, birth_date, joined_at, marketing_at) VALUES (1, '1990-05-01', now(), now())")
    const { order } = await orderWithCheckout(t)
    const res = await t.as(1).post('/members/me/withdraw')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ withdrawnAt: '2026-10-21T03:00:00.000Z', retainUntil: '2031-10-21T03:00:00.000Z' })
    expect(await memberRow(1)).toBeUndefined()

    const retention = t.app.get(RetentionService)
    const orderCount = async () => Number((await t.db.query('SELECT count(*) FROM orders WHERE id = $1', [order.id])).rows[0].count)
    t.clock.set('2031-10-21T02:59:59.000Z')
    expect(await retention.purgeExpired()).toBe(0)
    expect(await orderCount()).toBe(1)
    t.clock.set('2031-10-21T03:00:00.000Z')
    expect(await retention.purgeExpired()).toBe(1)
    expect(await orderCount()).toBe(0)
    expect((await t.db.query('SELECT count(*) FROM payments WHERE order_id = $1', [order.id])).rows[0].count).toBe('0')
  })

  it('두 번 탈퇴하지 않는다', async () => {
    expect((await t.as(2).post('/members/me/withdraw')).status).toBe(200)
    const again = await t.as(2).post('/members/me/withdraw')
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('ALREADY_WITHDRAWN')
  })
})
