import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { API, order, server } from '../test/server'
import { openAt } from '../test/render'

// 슬롭 — 결과 화면을 한 번만 열고 구매 이벤트가 나갔는지만 본다.
// 새로 고침·다시 열기를 시험하지 않아서, 화면이 열릴 때마다 다시 보내도 통과한다
describe('구매 이벤트', () => {
  it('결제가 끝나면 구매 이벤트를 보낸다', async () => {
    const listener = vi.fn()
    window.addEventListener('shop:purchase', listener)
    server.use(http.post(`${API}/payments/confirm`, () => HttpResponse.json(order())))

    openAt('/payments/success?paymentKey=pay_7&orderId=7&amount=15000')
    await screen.findByRole('heading', { name: '결제가 끝났어요' })

    expect(listener).toHaveBeenCalled()
    window.removeEventListener('shop:purchase', listener)
  })
})
