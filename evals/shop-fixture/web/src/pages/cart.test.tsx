import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API, quote, server } from '../test/server'
import { openAt } from '../test/render'

describe('장바구니', () => {
  it('금액은 서버가 계산한 값을 그대로 보인다 — 배송비를 더한 결제 금액과 무료 배송까지 남은 금액', async () => {
    openAt('/cart', [{ productId: 1, quantity: 2 }])
    expect(await screen.findByText('15,000원')).toBeInTheDocument()
    expect(screen.getByText('3,000원')).toBeInTheDocument()
    expect(screen.getByText('18,000원 더 담으면 무료 배송이에요')).toBeInTheDocument()
  })

  it('수량은 1 이상, 상품의 최대 수량 이하의 정수만 받는다 — 잘못된 값이면 서버에 묻지 않는다', async () => {
    const asked: unknown[] = []
    server.use(http.post(`${API}/orders/quote`, async ({ request }) => (asked.push(await request.json()), HttpResponse.json(quote()))))
    const { user } = openAt('/cart', [{ productId: 1, quantity: 2 }])
    const input = await screen.findByRole('spinbutton', { name: '잔치국수 수량' })
    await screen.findByText('15,000원')
    const before = asked.length
    // 한 글자씩 치면 "11"을 치는 도중의 "1"은 올바른 값이다 — 값을 한 번에 넣는다
    for (const value of ['0', '1.5', '11']) {
      await user.clear(input)
      await user.click(input)
      await user.paste(value)
      expect(screen.getByRole('alert')).toHaveTextContent('1~10개 사이의 정수로 입력해 주세요')
    }
    expect(asked.length).toBe(before)
    expect(screen.getByRole('button', { name: '주문하기' })).toBeDisabled()
  })

  it('쿠폰 오류는 서버가 준 코드로 문구를 고른다', async () => {
    server.use(http.post(`${API}/orders/quote`, async ({ request }) => {
      const body = (await request.json()) as { couponCode?: string }
      return body.couponCode ? HttpResponse.json({ code: 'COUPON_OUT_OF_PERIOD', message: '쓸 수 있는 기간이 아니다' }, { status: 400 }) : HttpResponse.json(quote())
    }))
    const { user } = openAt('/cart', [{ productId: 1, quantity: 2 }])
    await screen.findByText('15,000원')
    await user.type(screen.getByRole('textbox', { name: '쿠폰 코드' }), 'HALLOWEEN')
    await user.click(screen.getByRole('button', { name: '쿠폰 적용' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('지금은 쓸 수 없는 쿠폰이에요')
  })
})
