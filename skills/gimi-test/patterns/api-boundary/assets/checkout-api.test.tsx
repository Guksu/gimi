import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API, order, server } from '../test/server'
import { openAt } from '../test/render'

const CONSENT = '주문 내용을 확인했고 결제에 동의해요'
const PAY = '15,000원 결제하기'

/** 주문 확인 화면을 열고 동의까지 한다 — 결제창 이동(location.assign)은 앱을 띄운 뒤에 가로챈다 */
const openCheckout = async () => {
  const assign = vi.fn()
  const { user } = openAt('/checkout', [{ productId: 1, quantity: 2 }])
  vi.stubGlobal('location', { ...window.location, assign })
  await user.click(await screen.findByRole('checkbox', { name: CONSENT }))
  return { assign, pay: () => user.click(screen.getByRole('button', { name: PAY })) }
}
afterEach(() => {
  vi.unstubAllGlobals()
})

const checkoutOk = http.post(`${API}/orders/7/checkout`, () => HttpResponse.json({ paymentKey: 'pay_1', checkoutUrl: 'http://pg.test/checkout/pay_1' }, { status: 201 }))
const orderCreated = () => HttpResponse.json(order({ status: 'pending_payment' }), { status: 201 })

// API는 네트워크 경계(MSW)에서만 바꾼다 — 화면·api 모듈·fetch는 실물이다. 응답마다 사용자가 보는 결과와 보낸 요청을 본다
describe('주문 확인 — 주문 API의 응답마다', () => {
  it('성공(201)이면 서버가 준 결제창 주소로 간다 — 요청에는 금액을 넣지 않는다', async () => {
    let body: unknown
    server.use(
      http.post(`${API}/orders`, async ({ request }) => {
        body = await request.json()
        return orderCreated()
      }),
      checkoutOk,
    )
    const { pay, assign } = await openCheckout()
    await pay()
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('http://pg.test/checkout/pay_1'))
    expect(body).toEqual({ items: [{ productId: 1, quantity: 2 }], method: 'card' })
  })

  it('재고 부족(409)이면 이유를 보이고, 결제창으로 가지 않으며, 다시 누를 수 있다', async () => {
    server.use(http.post(`${API}/orders`, () => HttpResponse.json({ code: 'OUT_OF_STOCK', message: '재고가 모자라다' }, { status: 409 })))
    const { pay, assign } = await openCheckout()
    await pay()
    expect(await screen.findByRole('alert')).toHaveTextContent('재고가 모자란 상품이 있어요')
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: PAY })).toBeEnabled()
  })

  it('서버 오류(500)면 서버의 문장이 아니라 화면의 안내 문구를 보인다', async () => {
    server.use(http.post(`${API}/orders`, () => HttpResponse.json({ code: 'INTERNAL', message: 'TypeError at OrdersService' }, { status: 500 })))
    const { pay } = await openCheckout()
    await pay()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('문제가 생겼어요. 잠시 뒤 다시 시도해 주세요')
    expect(alert).not.toHaveTextContent('TypeError')
  })

  it('응답이 끊긴 뒤 다시 누르면 같은 멱등 키로 보낸다 — 서버가 이미 만든 주문이면 그 주문을 돌려받는다', async () => {
    const keys: (string | null)[] = []
    server.use(
      http.post(`${API}/orders`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'))
        return keys.length === 1 ? HttpResponse.error() : orderCreated()
      }),
      checkoutOk,
    )
    const { pay, assign } = await openCheckout()
    await pay()
    await screen.findByRole('alert')
    await pay()
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('http://pg.test/checkout/pay_1'))
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('응답을 기다리는 동안 버튼을 잠근다 — 시간을 기다리지 않고 응답을 손으로 놓아준다', async () => {
    let release = () => {}
    const answered = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.post(`${API}/orders`, async () => {
        await answered
        return orderCreated()
      }),
      checkoutOk,
    )
    const { pay, assign } = await openCheckout()
    await pay()
    expect(screen.getByRole('button', { name: PAY })).toBeDisabled()
    release()
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('http://pg.test/checkout/pay_1'))
  })
})
