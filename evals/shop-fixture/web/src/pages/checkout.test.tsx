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

  it('주문 요청의 응답이 끊긴 뒤 다시 눌러도 같은 멱등 키로 보낸다 — 서버가 이미 만든 주문이면 그 주문을 돌려받는다', async () => {
    const keys: string[] = []
    server.use(
      http.post(`${API}/orders`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key') ?? '')
        // 첫 요청은 서버가 주문을 만든 뒤 응답이 끊긴 경우다
        return keys.length === 1 ? HttpResponse.error() : HttpResponse.json(order({ status: 'pending_payment' }), { status: 200 })
      }),
      http.post(`${API}/orders/7/checkout`, () => HttpResponse.json({ paymentKey: 'pay_1', checkoutUrl: 'http://pg.test/checkout/pay_1' }, { status: 201 })),
    )
    const assign = vi.fn()
    const { user } = openAt('/checkout', [{ productId: 1, quantity: 2 }])
    vi.stubGlobal('location', { ...window.location, assign })
    try {
      await user.click(await screen.findByRole('checkbox', { name: '주문 내용을 확인했고 결제에 동의해요' }))
      await user.click(screen.getByRole('button', { name: '15,000원 결제하기' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('문제가 생겼어요. 잠시 뒤 다시 시도해 주세요')
      await user.click(screen.getByRole('button', { name: '15,000원 결제하기' }))
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('http://pg.test/checkout/pay_1'))
      expect(keys).toHaveLength(2)
      expect(keys[1]).toBe(keys[0])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('멤버십 가입은 비어 있다 — 고르지 않으면 가입하지 않고, 고르면 주문과 함께 가입한다', async () => {
    let created = 0
    let joined = 0
    server.use(
      http.post(`${API}/orders`, () => {
        created += 1
        return HttpResponse.json(order({ status: 'paid' }), { status: 201 })
      }),
      http.post(`${API}/memberships`, () => {
        joined += 1
        return HttpResponse.json({ price: 2900, nextBillingAt: '2026-11-21T03:00:00.000Z' }, { status: 201 })
      }),
      http.get(`${API}/orders/7`, () => HttpResponse.json(order())),
    )
    const pay = async (join: boolean) => {
      const { user, unmount } = openAt('/checkout', [{ productId: 1, quantity: 2 }])
      const membership = await screen.findByRole('checkbox', { name: '국수 멤버십도 가입할게요(매달 2,900원 자동 결제)' })
      expect(membership).not.toBeChecked()
      if (join) await user.click(membership)
      await user.click(screen.getByRole('checkbox', { name: '주문 내용을 확인했고 결제에 동의해요' }))
      await user.click(screen.getByRole('button', { name: '15,000원 결제하기' }))
      // 결제가 끝난 주문이면 주문 화면으로 간다 — 멤버십 가입은 그 전에 끝난다
      await vi.waitFor(() => expect(window.location.pathname).toBe('/orders/7'))
      unmount()
    }
    await pay(false)
    expect([created, joined]).toEqual([1, 0])
    await pay(true)
    expect([created, joined]).toEqual([2, 1])
  })
})
