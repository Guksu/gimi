import { describe, expect, it, vi } from 'vitest'
import { OrdersService } from '../src/orders/orders.service'

// 슬롭 — 저장소(DB)를 mock한다. mock은 어떤 SQL에도 주문 한 건을 돌려줘서,
// 조회 조건(WHERE user_id)이 빠져도, SQL이 틀려도 통과한다. 단언은 mock이 돌려준 값을 다시 확인할 뿐이다
describe('OrdersService.row', () => {
  it('주문을 찾아 돌려준다', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: '7', user_id: '1', status: 'pending_payment' }] })
    const service = new OrdersService({ pool: { query } } as never, {} as never, {} as never, {} as never, {} as never)

    const order = await service.row(1, 7)

    expect(order.id).toBe('7')
    expect(query).toHaveBeenCalledTimes(1)
  })
})
