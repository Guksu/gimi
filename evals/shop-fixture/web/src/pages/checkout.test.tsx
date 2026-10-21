import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { API, order, server } from '../test/server'
import { openAt } from '../test/render'

describe('주문 확인·결제', () => {
  it('배송비를 포함한 총 결제 금액을 보이고, 결제 동의는 비어 있으며 동의 전에는 결제할 수 없다', async () => {
    const { user } = openAt('/checkout', [{ productId: 1, quantity: 2 }])
    expect(await screen.findByText('총 결제 금액')).toBeInTheDocument()
    expect(screen.getByText('15,000원')).toBeInTheDocument()
    const consent = screen.getByRole('checkbox', { name: '주문 내용을 확인했고 결제에 동의해요' })
    expect(consent).not.toBeChecked()
    expect(screen.getByRole('button', { name: '15,000원 결제하기' })).toBeDisabled()
    await user.click(consent)
    expect(screen.getByRole('button', { name: '15,000원 결제하기' })).toBeEnabled()
  })

  it('결제 버튼을 연달아 눌러도 주문은 한 번만 만든다 — 같은 멱등 키를 쓰고 결제창으로 간다', async () => {
    const keys: string[] = []
    server.use(
      http.post(`${API}/orders`, async ({ request }) => {
        keys.push(request.headers.get('idempotency-key') ?? '')
        await new Promise((resolve) => setTimeout(resolve, 50))
        return HttpResponse.json(order({ status: 'pending_payment' }), { status: 201 })
      }),
      http.post(`${API}/orders/7/checkout`, () => HttpResponse.json({ paymentKey: 'pay_1', checkoutUrl: 'http://pg.test/checkout/pay_1' }, { status: 201 })),
    )
    const assign = vi.fn()
    const { user } = openAt('/checkout', [{ productId: 1, quantity: 2 }])
    // 앱을 띄운 뒤에 바꾼다 — 라우터는 처음 그릴 때 진짜 주소를 읽는다
    vi.stubGlobal('location', { ...window.location, assign })
    try {
      await user.click(await screen.findByRole('checkbox', { name: '주문 내용을 확인했고 결제에 동의해요' }))
      const pay = screen.getByRole('button', { name: '15,000원 결제하기' })
      await user.dblClick(pay)
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('http://pg.test/checkout/pay_1'))
      expect(keys.length).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
