import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

// 슬롭 — 요구사항이 아니라 구현(subtotal·FREE_SHIPPING_THRESHOLD)을 보고 썼다. 이름도 코드의 이름이다.
// 쿠폰을 쓰는 경우가 없어서, 기준 금액을 쿠폰 전 금액으로 잘못 잡아도 통과한다
describe('PricingService 배송비', () => {
  it('subtotal이 FREE_SHIPPING_THRESHOLD 이상이면 shippingFee는 0', async () => {
    await t.db.query('UPDATE products SET price = 30000 WHERE id = 1')

    const res = await t.as(1).post('/orders/quote').send({ method: 'card', items: [{ productId: 1, quantity: 1 }] })

    expect(res.body.shippingFee).toBe(0)
  })

  it('subtotal이 FREE_SHIPPING_THRESHOLD보다 작으면 shippingFee는 SHIPPING_FEE', async () => {
    await t.db.query('UPDATE products SET price = 29000 WHERE id = 1')

    const res = await t.as(1).post('/orders/quote').send({ method: 'card', items: [{ productId: 1, quantity: 1 }] })

    expect(res.body.shippingFee).toBe(3000)
  })
})
