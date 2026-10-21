import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const create = (body: Record<string, unknown>, key: string, user = 1) => t.as(user).post('/orders').set('idempotency-key', key).send({ method: 'card', ...body })
const stockOf = async (id: number) => (await t.db.query('SELECT stock FROM products WHERE id = $1', [id])).rows[0].stock

describe('POST /orders', () => {
  it('서버가 다시 계산한 금액으로 결제 대기 주문을 만들고 재고·쿠폰·포인트를 차감한다 — 요청의 금액 필드는 쓰지 않는다', async () => {
    const res = await create({ items: [{ productId: 1, quantity: 2 }], couponCode: 'NOODLE10', points: 1000, total: 100, price: 1 }, 'k-1')
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ status: 'pending_payment', subtotal: 12000, couponDiscount: 1200, pointsUsed: 1000, shippingFee: 3000, total: 12800 })
    expect(await stockOf(1)).toBe(18)
    expect((await t.db.query("SELECT used_count FROM coupons WHERE code = 'NOODLE10'")).rows[0].used_count).toBe(1)
    expect((await t.db.query('SELECT points FROM users WHERE id = 1')).rows[0].points).toBe(4000)
  })

  it('같은 멱등 키로 다시 보내면 같은 주문을 돌려주고 두 번 차감하지 않는다. 멱등 키가 없으면 거절한다', async () => {
    const first = await create({ items: [{ productId: 1, quantity: 1 }] }, 'k-same')
    const again = await create({ items: [{ productId: 1, quantity: 1 }] }, 'k-same')
    expect(again.status).toBe(200)
    expect(again.body.id).toBe(first.body.id)
    expect(await stockOf(1)).toBe(19)
    const missing = await t.as(1).post('/orders').send({ items: [{ productId: 1, quantity: 1 }], method: 'card' })
    expect([missing.status, missing.body.code]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED'])
  })

  it('재고 1개에 동시 주문 5건이면 1건만 성공하고 재고는 0이다', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => create({ items: [{ productId: 5, quantity: 1 }] }, `k-race-${n}`)))
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409])
    // 먼저 끝난 주문이 재고를 0으로 만들면 뒤의 주문은 품절로 보인다 — 둘 다 재고 충돌(409)이다
    expect(results.filter((r) => r.status === 409).every((r) => ['OUT_OF_STOCK', 'SOLD_OUT'].includes(r.body.code))).toBe(true)
    expect(await stockOf(5)).toBe(0)
  })

  it('한도 1인 쿠폰을 동시에 쓰면 1건만 성공하고, 같은 사람은 쿠폰을 두 번 쓸 수 없다', async () => {
    const both = await Promise.all([create({ items: [{ productId: 1, quantity: 1 }], couponCode: 'LAST1' }, 'k-c1', 1), create({ items: [{ productId: 1, quantity: 1 }], couponCode: 'LAST1' }, 'k-c2', 2)])
    expect(both.map((r) => r.status).sort()).toEqual([201, 409])
    await create({ items: [{ productId: 1, quantity: 1 }], couponCode: 'NOODLE10' }, 'k-c3', 1)
    expect((await create({ items: [{ productId: 1, quantity: 1 }], couponCode: 'NOODLE10' }, 'k-c4', 1)).body.code).toBe('COUPON_ALREADY_USED')
  })

  it('보유 포인트를 넘는 동시 사용은 막는다 — 5,000점으로 3,000점씩 두 주문', async () => {
    const both = await Promise.all([create({ items: [{ productId: 1, quantity: 1 }], points: 3000 }, 'k-p1'), create({ items: [{ productId: 1, quantity: 1 }], points: 3000 }, 'k-p2')])
    expect(both.map((r) => r.status).sort()).toEqual([201, 409])
    expect((await t.db.query('SELECT points FROM users WHERE id = 1')).rows[0].points).toBe(2000)
  })

  it('실패한 주문은 재고·쿠폰·포인트를 하나도 차감하지 않는다(같은 트랜잭션)', async () => {
    await t.db.query('UPDATE products SET stock = 0 WHERE id = 2')
    const res = await create({ items: [{ productId: 1, quantity: 1 }, { productId: 2, quantity: 1 }], couponCode: 'NOODLE10', points: 100 }, 'k-fail')
    expect([res.status, res.body.code]).toEqual([409, 'SOLD_OUT'])
    expect(await stockOf(1)).toBe(20)
    expect((await t.db.query("SELECT used_count FROM coupons WHERE code = 'NOODLE10'")).rows[0].used_count).toBe(0)
  })

  it('0원 주문은 결제 없이 바로 결제 완료가 된다', async () => {
    const res = await create({ items: [{ productId: 1, quantity: 1 }], couponCode: 'BIG50000', points: 3000 }, 'k-free')
    expect(res.body).toMatchObject({ status: 'paid', total: 0 })
  })
})

describe('GET /orders/:id', () => {
  it('내 주문만 보이고, 남의 주문은 없는 것과 같다', async () => {
    const mine = await create({ items: [{ productId: 1, quantity: 1 }] }, 'k-own')
    expect((await t.as(1).get(`/orders/${mine.body.id}`)).status).toBe(200)
    expect((await t.as(2).get(`/orders/${mine.body.id}`)).status).toBe(404)
    expect((await t.as(1).get('/orders')).body.items.map((o: any) => o.id)).toEqual([mine.body.id])
    expect((await t.as(2).get('/orders')).body.items).toEqual([])
  })

  it('사용자 머리(x-user-id)가 없으면 401이다', async () => {
    const res = await t.app.getHttpServer()
    const anonymous = await (await import('supertest')).default(res).get('/orders')
    expect(anonymous.status).toBe(401)
  })
})
