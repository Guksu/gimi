import { describe, expect, it, vi } from 'vitest'
import { PricingService } from '../src/pricing/pricing.service'

// 슬롭 — 금액 계산 조각(PricingService)만 떼어 내고 DB를 mock해 테스트한다.
// 주문 API가 그 계산 결과를 저장하는지, 요청이 보낸 금액을 무시하는지는 시험하지 않아서,
// 주문이 화면의 총액을 그대로 저장해도 통과한다. mock에 넣은 값(가격 6,000원)을 다시 계산해 볼 뿐이다
describe('PricingService.quote', () => {
  it('잔치국수 2개면 결제 금액은 15,000원이다', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: '1', name: '잔치국수', price: 6000, stock: 20, max_per_order: 10, returnable: true }] })
    const pricing = new PricingService({ pool: { query } } as never, {} as never)

    const quote = await pricing.quote(1, { method: 'card', items: [{ productId: 1, quantity: 2 }] })

    expect(quote.total).toBe(15000)
  })
})
