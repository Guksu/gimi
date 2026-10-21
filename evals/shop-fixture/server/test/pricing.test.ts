import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const quote = (body: Record<string, unknown>) => t.as(1).post('/orders/quote').send({ method: 'card', ...body })

describe('GET /products', () => {
  it('가격·재고·품절·반품 가능 여부를 준다', async () => {
    const res = await t.as(1).get('/products')
    expect(res.status).toBe(200)
    expect(res.body.items.find((p: any) => p.id === 3)).toMatchObject({ name: '칼국수', price: 8000, stock: 0, soldOut: true })
    expect(res.body.items.find((p: any) => p.id === 4)).toMatchObject({ returnable: false, maxPerOrder: 3 })
  })
})

describe('POST /orders/quote — 금액은 서버가 원 단위 정수로 계산한다', () => {
  it('줄마다 단가 × 수량, 합계·배송비·결제 금액을 낸다', async () => {
    const res = await quote({ items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }] })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ subtotal: 19000, couponDiscount: 0, pointsUsed: 0, shippingFee: 3000, total: 22000, freeShippingThreshold: 30000 })
    expect(res.body.lines).toEqual([
      { productId: 1, name: '잔치국수', unitPrice: 6000, quantity: 2, lineTotal: 12000 },
      { productId: 2, name: '비빔국수', unitPrice: 7000, quantity: 1, lineTotal: 7000 },
    ])
  })

  it.each([
    [0, 'INVALID_QUANTITY'],
    [-1, 'INVALID_QUANTITY'],
    [1.5, 'INVALID_QUANTITY'],
    ['2', 'INVALID_QUANTITY'],
    [11, 'INVALID_QUANTITY'],
  ])('수량 %s는 거절한다(%s)', async (quantity, code) => {
    const res = await quote({ items: [{ productId: 1, quantity }] })
    expect([res.status, res.body.code]).toEqual([400, code])
  })

  it('상품마다 정한 최대 수량과 재고를 넘으면 거절하고, 품절 상품은 담을 수 없다', async () => {
    expect((await quote({ items: [{ productId: 4, quantity: 4 }] })).body.code).toBe('INVALID_QUANTITY')
    expect((await quote({ items: [{ productId: 2, quantity: 6 }] })).body.code).toBe('OUT_OF_STOCK')
    expect((await quote({ items: [{ productId: 3, quantity: 1 }] })).body.code).toBe('SOLD_OUT')
    expect((await quote({ items: [] })).body.code).toBe('EMPTY_ORDER')
    expect((await quote({ items: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 1 }] })).body.code).toBe('DUPLICATE_ITEM')
  })

  it('정률 쿠폰은 원 미만을 버린다 — 9,990원의 10%는 999원', async () => {
    await t.db.query('UPDATE products SET price = 9990 WHERE id = 1')
    const res = await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'NOODLE10' })
    expect(res.body).toMatchObject({ subtotal: 9990, couponDiscount: 999, shippingFee: 3000, total: 11991 })
  })

  it('정액 쿠폰이 상품가보다 크면 할인은 상품가까지다 — 결제 금액은 배송비만 남는다', async () => {
    const res = await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'BIG50000' })
    expect(res.body).toMatchObject({ subtotal: 6000, couponDiscount: 6000, shippingFee: 3000, total: 3000 })
  })

  it('쿠폰은 최소 주문 금액·기간[시작, 끝)·사용 한도·사람당 한 번을 지킨다', async () => {
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'WELCOME3000' })).body.code).toBe('COUPON_MIN_ORDER')
    expect((await quote({ items: [{ productId: 1, quantity: 2 }], couponCode: 'WELCOME3000' })).body.couponDiscount).toBe(3000)
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'NOPE' })).body.code).toBe('COUPON_NOT_FOUND')

    // HALLOWEEN은 한국 시간 10월 31일 23:59:59까지
    t.clock.set('2026-10-31T14:59:59.999Z')
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'HALLOWEEN' })).body.couponDiscount).toBe(2000)
    t.clock.set('2026-10-31T15:00:00.000Z')
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'HALLOWEEN' })).body.code).toBe('COUPON_OUT_OF_PERIOD')
    t.clock.set('2026-09-30T14:59:59.999Z')
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'HALLOWEEN' })).body.code).toBe('COUPON_OUT_OF_PERIOD')

    await t.db.query("UPDATE coupons SET used_count = max_uses WHERE code = 'LAST1'")
    t.clock.set('2026-10-21T03:00:00.000Z')
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'LAST1' })).body.code).toBe('COUPON_EXHAUSTED')
  })

  it('무료 배송은 쿠폰 할인 뒤 금액이 3만 원 "이상"일 때다 — 29,999·30,000·30,001원', async () => {
    const at = async (subtotal: number) => {
      await t.db.query('UPDATE products SET price = $1 WHERE id = 1', [subtotal])
      return (await quote({ items: [{ productId: 1, quantity: 1 }] })).body.shippingFee
    }
    expect([await at(29999), await at(30000), await at(30001)]).toEqual([3000, 0, 0])
    await t.db.query('UPDATE products SET price = 32000 WHERE id = 1')
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'WELCOME3000' })).body).toMatchObject({ couponDiscount: 3000, shippingFee: 3000 })
  })

  it('포인트는 10원 단위로, 보유량과 결제 금액 안에서만 쓴다 — 쿠폰 다음에 뺀다', async () => {
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], points: 15 })).body.code).toBe('POINTS_UNIT')
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], points: 5010 })).body.code).toBe('POINTS_EXCEED_BALANCE')
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'BIG50000', points: 3010 })).body.code).toBe('POINTS_EXCEED_PAYABLE')
    expect((await quote({ items: [{ productId: 1, quantity: 2 }], couponCode: 'NOODLE10', points: 5000 })).body).toMatchObject({ subtotal: 12000, couponDiscount: 1200, pointsUsed: 5000, shippingFee: 3000, total: 8800 })
  })

  it('0원 주문은 결제 없이 확정하고, 0원이 아니면 결제수단별 최소 금액을 지킨다', async () => {
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'BIG50000', points: 3000 })).body.total).toBe(0)
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'BIG50000', points: 2950 })).body.code).toBe('BELOW_MINIMUM_AMOUNT')
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'BIG50000', points: 2900, method: 'card' })).body.total).toBe(100)
    expect((await quote({ items: [{ productId: 1, quantity: 1 }], couponCode: 'BIG50000', points: 2900, method: 'transfer' })).body.code).toBe('BELOW_MINIMUM_AMOUNT')
  })
})
