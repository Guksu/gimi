import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MembershipsService } from '../src/memberships/memberships.service'
import { startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const charges = async () => (await t.db.query('SELECT amount FROM membership_charges ORDER BY id')).rows.map((row) => row.amount)

describe('멤버십', () => {
  it('요금을 보이고, 가입하면 첫 달을 청구하고 다음 달 같은 날을 청구일로 둔다', async () => {
    expect((await t.as(1).get('/memberships/plan')).body).toEqual({ price: 2900 })
    const res = await t.as(1).post('/memberships')
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ price: 2900, nextBillingAt: '2026-11-21T03:00:00.000Z' })
    expect(await charges()).toEqual([2900])
    expect((await t.as(1).post('/memberships')).body.code).toBe('ALREADY_MEMBER')
  })

  it('청구일은 가입한 날(한국 날짜)과 같은 날이고, 그달에 없으면 그달 마지막 날이다', async () => {
    t.clock.set('2027-01-31T03:00:00Z')
    expect((await t.as(1).post('/memberships')).body.nextBillingAt).toBe('2027-02-28T03:00:00.000Z')
    t.clock.set('2027-02-28T03:00:00Z')
    expect(await t.app.get(MembershipsService).billDue()).toBe(1)
    expect((await t.db.query('SELECT next_billing_at FROM memberships WHERE user_id = 1')).rows[0].next_billing_at.toISOString()).toBe('2027-03-31T03:00:00.000Z')
  })

  it('해지는 요청 한 번이다 — 가입하지 않았으면 404', async () => {
    await t.as(1).post('/memberships')
    const res = await t.as(1).post('/memberships/me/cancel')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ cancelledAt: '2026-10-21T03:00:00.000Z' })
    expect((await t.as(1).post('/memberships/me/cancel')).body.code).toBe('NOT_MEMBER')
  })
})

describe('멤버십 정기 청구 — 요금 인상', () => {
  const billAt = async (iso: string) => {
    t.clock.set(iso)
    return t.app.get(MembershipsService).billDue()
  }
  beforeEach(async () => {
    await t.as(1).post('/memberships')
    await t.db.query('UPDATE membership_plan SET price = 3900')
  })

  it('오른 요금에 따로 동의하지 않았으면 종전 요금으로 청구한다 — 가입 때 동의는 인상 동의가 아니다', async () => {
    expect(await billAt('2026-11-21T03:00:00Z')).toBe(1)
    expect(await charges()).toEqual([2900, 2900])
  })

  it('청구일 전 30일 안에 오른 요금에 동의했으면 새 요금으로 청구하고, 31일 전 동의는 쓰지 않는다', async () => {
    await t.db.query("INSERT INTO membership_price_consents (user_id, price, from_price, consented_at) VALUES (1, 3900, 2900, '2026-10-22T03:00:00Z')")
    await billAt('2026-11-21T03:00:00Z')
    expect(await charges()).toEqual([2900, 3900])

    await t.db.query("UPDATE membership_plan SET price = 4900")
    await t.db.query("INSERT INTO membership_price_consents (user_id, price, from_price, consented_at) VALUES (1, 4900, 3900, '2026-11-20T03:00:00Z')")
    // 다음 청구일 2026-12-21의 31일 전 동의
    await billAt('2026-12-21T03:00:00Z')
    expect(await charges()).toEqual([2900, 3900, 3900])
  })

  it('회원이 오른 요금에 동의하면 다음 청구부터 새 요금이다 — 요금이 오르지 않았으면 동의를 받지 않는다', async () => {
    t.clock.set('2026-11-01T03:00:00Z')
    const res = await t.as(1).post('/memberships/me/price-consent')
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ fromPrice: 2900, price: 3900, consentedAt: '2026-11-01T03:00:00.000Z' })
    await billAt('2026-11-21T03:00:00Z')
    expect(await charges()).toEqual([2900, 3900])
    expect((await t.as(1).post('/memberships/me/price-consent')).body.code).toBe('NO_PRICE_INCREASE')
  })

  it('청구일이 되지 않은 멤버십은 청구하지 않는다', async () => {
    expect(await billAt('2026-11-21T02:59:59Z')).toBe(0)
    expect(await charges()).toEqual([2900])
  })
})
