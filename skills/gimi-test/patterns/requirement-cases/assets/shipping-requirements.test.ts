import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const priceOfNoodle = (won: number) => t.db.query('UPDATE products SET price = $1 WHERE id = 1', [won])
const quote = (body: Record<string, unknown>) => t.as(1).post('/orders/quote').send({ method: 'card', items: [{ productId: 1, quantity: 1 }], ...body })

// 요구사항(기획 문서 '배송비 정책')을 항목마다 테스트로 옮긴다 — 테스트 이름이 요구사항 문장이다.
// 구현을 보고 쓰지 않는다. 문서에 없는 경우는 it.todo로 남겨 묻는다
describe("요구사항 — 배송비 정책", () => {
  it('1. 쿠폰을 적용한 뒤 상품 금액이 30,000원 이상이면 배송비 0원', async () => {
    await priceOfNoodle(33000)

    const res = await quote({ couponCode: 'WELCOME3000' })

    expect(res.body).toMatchObject({ couponDiscount: 3000, shippingFee: 0 })
  })

  it('1의 경계 — 쿠폰을 적용해 30,000원 아래로 내려가면 배송비가 붙는다(32,000원 − 3,000원)', async () => {
    await priceOfNoodle(32000)

    const res = await quote({ couponCode: 'WELCOME3000' })

    expect(res.body).toMatchObject({ couponDiscount: 3000, shippingFee: 3000 })
  })

  it('2. 그 밖에는 배송비 3,000원', async () => {
    await priceOfNoodle(29000)

    expect((await quote({})).body.shippingFee).toBe(3000)
  })

  it('3. 포인트는 배송비를 정할 때 빼지 않는다 — 30,000원에 포인트 1,000점을 써도 배송비 0원', async () => {
    await priceOfNoodle(30000)

    const res = await quote({ points: 1000 })

    expect(res.body).toMatchObject({ pointsUsed: 1000, shippingFee: 0, total: 29000 })
  })

  it.todo('문서에 없음 — 제주·도서 산간의 추가 배송비. 기획에 묻고 정한다')
})
