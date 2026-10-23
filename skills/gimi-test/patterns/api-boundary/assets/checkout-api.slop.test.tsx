import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { order, quote } from '../test/server'
import { openAt } from '../test/render'

// 슬롭 — 테스트 대상이 부르는 api 모듈을 통째로 mock하고, 그 mock이 불렸는지만 단언한다.
// 무엇을 보냈는지(멱등 키)는 보지 않아서, 다시 누를 때 키가 바뀌어 주문이 두 번 생겨도 통과한다
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, api: { ...actual.api, quote: vi.fn(), createOrder: vi.fn(), checkout: vi.fn() } }
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('주문 확인', () => {
  it('주문에 실패하면 다시 눌러 주문할 수 있다', async () => {
    vi.mocked(api.quote).mockResolvedValue({ status: 200, data: quote() })
    vi.mocked(api.createOrder)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ status: 201, data: order({ status: 'pending_payment' }) })
    vi.mocked(api.checkout).mockResolvedValue({ status: 201, data: { paymentKey: 'pay_1', checkoutUrl: 'http://pg.test/checkout/pay_1' } })
    const { user } = openAt('/checkout', [{ productId: 1, quantity: 2 }])
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() })

    await user.click(await screen.findByRole('checkbox', { name: '주문 내용을 확인했고 결제에 동의해요' }))
    await user.click(screen.getByRole('button', { name: '15,000원 결제하기' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: '15,000원 결제하기' }))

    await vi.waitFor(() => expect(api.checkout).toHaveBeenCalledWith(7))
    expect(api.createOrder).toHaveBeenCalledTimes(2)
  })
})
