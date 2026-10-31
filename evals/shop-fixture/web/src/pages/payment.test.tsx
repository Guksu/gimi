import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API, order, server } from '../test/server'
import { openAt } from '../test/render'

describe('결제 결과', () => {
  it('돌아온 주소의 값으로 서버에 확정을 요청하고, 결과는 서버 응답으로 보인다 — 주소의 금액을 믿지 않는다', async () => {
    const bodies: unknown[] = []
    server.use(http.post(`${API}/payments/confirm`, async ({ request }) => (bodies.push(await request.json()), HttpResponse.json(order({ total: 15000 })))))
    openAt('/payments/success?paymentKey=pay_1&orderId=7&amount=15000')
    expect(await screen.findByRole('heading', { name: '결제가 끝났어요' })).toBeInTheDocument()
    expect(screen.getByText('15,000원')).toBeInTheDocument()
    expect(bodies).toEqual([{ orderId: 7, paymentKey: 'pay_1', amount: 15000 }])
  })

  it('구매 이벤트는 주문마다 한 번만 보낸다 — 결과 화면을 새로 고쳐도', async () => {
    server.use(http.post(`${API}/payments/confirm`, () => HttpResponse.json(order())))
    const sent: unknown[] = []
    const listener = (event: Event) => sent.push((event as CustomEvent).detail)
    window.addEventListener('shop:purchase', listener)
    try {
      const first = openAt('/payments/success?paymentKey=pay_1&orderId=7&amount=15000')
      await screen.findByRole('heading', { name: '결제가 끝났어요' })
      first.unmount()
      openAt('/payments/success?paymentKey=pay_1&orderId=7&amount=15000')
      await screen.findByRole('heading', { name: '결제가 끝났어요' })
      expect(sent).toEqual([{ transactionId: '7', value: 15000, currency: 'KRW' }])
    } finally {
      window.removeEventListener('shop:purchase', listener)
    }
  })

  it('서버가 확인 중(202)이라고 하면 성공으로 보이지 않는다', async () => {
    server.use(http.post(`${API}/payments/confirm`, () => HttpResponse.json({ status: 'checking', message: '확인 중' }, { status: 202 })))
    openAt('/payments/success?paymentKey=pay_1&orderId=7&amount=15000')
    expect(await screen.findByRole('heading', { name: '결제를 확인하고 있어요' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '결제가 끝났어요' })).not.toBeInTheDocument()
  })

  it('결제창에서 취소하면 실패 화면에서 다시 결제할 수 있다', async () => {
    openAt('/payments/fail?code=USER_CANCEL&orderId=7')
    expect(await screen.findByRole('heading', { name: '결제를 취소했어요' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '주문으로 돌아가 다시 결제하기' })).toHaveAttribute('href', '/orders/7')
  })

  it('주문번호 없이 실패 화면에 오면 없는 주문 대신 메뉴로 보낸다', async () => {
    openAt('/payments/fail?code=PAY_PROCESS_ABORTED')
    expect(await screen.findByRole('heading', { name: '결제하지 못했어요' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '메뉴로 돌아가기' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('link', { name: '주문으로 돌아가 다시 결제하기' })).not.toBeInTheDocument()
  })
})
