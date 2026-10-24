import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

// 무엇을: 요구사항 "결제 금액은 서버가 계산하고 저장한 값만 PG에 보낸다"를 주문 API의 바깥(요청 → 응답·DB·PG)에서 본다.
// 실물: 앱 전체와 PostgreSQL. 가짜: 경계 밖의 PG(가짜 HTTP 서버)와 시계만 — 테스트 대상 안쪽은 mock하지 않는다
let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const order = (body: Record<string, unknown>) => t.as(1).post('/orders').set('idempotency-key', 'k-amount').send({ method: 'card', items: [{ productId: 1, quantity: 2 }], ...body })
const storedTotal = async (id: number) => (await t.db.query<{ total: number }>('SELECT total FROM orders WHERE id = $1', [id])).rows[0]?.total

describe('주문 금액은 서버가 계산한다', () => {
  it('요청에 total·price를 넣어도 무시하고 서버가 계산한 금액(15,000원)으로 주문한다', async () => {
    const res = await order({ total: 100, price: 1 })

    expect(res.status).toBe(201)
    expect(res.body.total).toBe(15000)
    expect(await storedTotal(res.body.id)).toBe(15000)
  })

  it('결제창은 저장한 금액으로 연다 — PG가 받은 금액도 15,000원이다', async () => {
    const { paymentKey } = await orderWithCheckout(t, { total: 100 })

    expect(t.pg.payments.get(paymentKey)?.totalAmount).toBe(15000)
  })

  it('쿠폰·포인트를 써도 금액은 서버가 계산한 값 하나다 — 12,000 − 1,200 + 3,000 − 1,000 = 12,800원', async () => {
    const res = await order({ couponCode: 'NOODLE10', points: 1000, total: 1 })

    expect(res.body).toMatchObject({ couponDiscount: 1200, pointsUsed: 1000, total: 12800 })
  })

  it('요청에 금액이 없어도 같은 금액이다 — 화면이 금액을 보내지 않아도 된다', async () => {
    const res = await order({})

    expect(res.body.total).toBe(15000)
  })
})
