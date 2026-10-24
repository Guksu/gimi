import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { API, order, quote, server } from '../test/server'
import { openAt } from '../test/render'

const returnUrl = (orderId: number) => `/payments/success?paymentKey=pay_${orderId}&orderId=${orderId}&amount=15000`
const DONE = { name: '결제가 끝났어요' }

// 분석 도구로 나가는 구매 이벤트를 창에서 듣고 모은다
const purchases: { transactionId: string }[] = []
const listen = (event: Event) => purchases.push((event as CustomEvent).detail)
beforeEach(() => {
  purchases.length = 0
  window.addEventListener('shop:purchase', listen)
})
afterEach(() => {
  window.removeEventListener('shop:purchase', listen)
  vi.unstubAllGlobals()
})

const confirmOk = () =>
  server.use(
    http.post(`${API}/payments/confirm`, async ({ request }) => {
      const { orderId } = (await request.json()) as { orderId: number }
      return HttpResponse.json(order({ id: orderId }))
    }),
  )

describe('다시 그려도, 다시 열어도, 겹쳐 와도 한 번', () => {
  it('결제 결과 화면을 새로 고쳐도 구매 이벤트는 한 번만 나간다', async () => {
    confirmOk()
    const first = openAt(returnUrl(7))
    await screen.findByRole('heading', DONE)

    // 새로 고침 — 화면을 내렸다가 같은 주소로 다시 연다. 브라우저 저장소는 남는다
    first.unmount()
    openAt(returnUrl(7))
    await screen.findByRole('heading', DONE)

    expect(purchases).toEqual([{ transactionId: '7', value: 15000, currency: 'KRW' }])
  })

  it('다른 주문은 따로 한 번씩 나간다 — 거래 ID는 주문번호다', async () => {
    confirmOk()
    const first = openAt(returnUrl(7))
    await screen.findByRole('heading', DONE)
    first.unmount()
    openAt(returnUrl(8))
    await screen.findByRole('heading', DONE)

    expect(purchases.map((p) => p.transactionId)).toEqual(['7', '8'])
  })

  it('StrictMode에서 effect가 두 번 돌아도 확정 요청은 한 번이다', async () => {
    let confirms = 0
    server.use(http.post(`${API}/payments/confirm`, () => (confirms++, HttpResponse.json(order()))))
    window.history.replaceState(null, '', returnUrl(7))

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findByRole('heading', DONE)

    expect(confirms).toBe(1)
    expect(purchases).toHaveLength(1)
  })

  it('결제하기를 연달아 눌러도 응답을 기다리는 동안 주문 요청은 한 번이다', async () => {
    let release = () => {}
    const answered = new Promise<void>((resolve) => (release = resolve))
    let requests = 0
    server.use(
      http.post(`${API}/orders`, async () => {
        requests++
        await answered
        return HttpResponse.json(order({ status: 'pending_payment' }), { status: 201 })
      }),
      http.post(`${API}/orders/7/checkout`, () => HttpResponse.json({ paymentKey: 'pay_1', checkoutUrl: 'http://pg.test/checkout/pay_1' }, { status: 201 })),
    )
    const assign = vi.fn()
    const { user } = openAt('/checkout', [{ productId: 1, quantity: 2 }])
    vi.stubGlobal('location', { ...window.location, assign })
    await user.click(await screen.findByRole('checkbox', { name: '주문 내용을 확인했고 결제에 동의해요' }))

    const pay = screen.getByRole('button', { name: '15,000원 결제하기' })
    await user.dblClick(pay)
    await user.click(pay)
    release()

    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(requests).toBe(1)
  })

  it('늦게 온 예전 응답이 최신 금액을 덮어쓰지 않는다', async () => {
    let releaseOld = () => {}
    const oldAnswered = new Promise<void>((resolve) => (releaseOld = resolve))
    let oldServed = false
    server.use(
      http.post(`${API}/orders/quote`, async ({ request }) => {
        const { items } = (await request.json()) as { items: { quantity: number }[] }
        if (items[0]?.quantity === 3) return HttpResponse.json(quote({ subtotal: 18000, total: 21000 }))
        // 수량 2의 응답은 붙잡아 두었다가 최신 응답 뒤에 보낸다
        await oldAnswered
        oldServed = true
        return HttpResponse.json(quote())
      }),
    )
    const { user } = openAt('/cart', [{ productId: 1, quantity: 2 }])
    const input = await screen.findByRole('spinbutton', { name: '잔치국수 수량' })

    await user.clear(input)
    await user.click(input)
    await user.paste('3')
    expect(await screen.findByText('21,000원')).toBeInTheDocument()

    releaseOld()
    await vi.waitFor(() => expect(oldServed).toBe(true))
    // 늦은 응답이 화면까지 갈 차례를 한 번 준다 — 시간을 기다리는 것이 아니라 대기열을 비운다
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('21,000원')).toBeInTheDocument()
    expect(screen.queryByText('15,000원')).not.toBeInTheDocument()
  })
})
