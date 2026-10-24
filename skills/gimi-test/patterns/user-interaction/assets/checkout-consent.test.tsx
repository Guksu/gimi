import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { API, quote, server } from '../test/server'
import { openAt } from '../test/render'

const CART = [{ productId: 1, quantity: 2 }]
const CONSENT = '주문 내용을 확인했고 결제에 동의해요'
const PAY = '15,000원 결제하기'

// 손님처럼 찾고(역할 + 이름) 손님처럼 누른다(user-event) — 내부 state나 DOM 구조로 찾지 않는다
describe('주문 확인 — 손님이 하는 조작마다', () => {
  it('처음 들어오면 결제 동의는 비어 있고, 결제하기는 눌리지 않는다', async () => {
    openAt('/checkout', CART)

    const consent = await screen.findByRole('checkbox', { name: CONSENT })

    expect(consent).not.toBeChecked()
    expect(screen.getByRole('button', { name: PAY })).toBeDisabled()
  })

  it('동의를 누르면 결제하기가 켜지고, 다시 누르면 꺼진다', async () => {
    const { user } = openAt('/checkout', CART)
    const consent = await screen.findByRole('checkbox', { name: CONSENT })

    await user.click(consent)
    expect(screen.getByRole('button', { name: PAY })).toBeEnabled()

    await user.click(consent)
    expect(screen.getByRole('button', { name: PAY })).toBeDisabled()
  })

  it('작은 네모 대신 동의 문구를 눌러도 켜진다 — 문구가 체크박스의 라벨이다', async () => {
    const { user } = openAt('/checkout', CART)

    await user.click(await screen.findByText(CONSENT))

    expect(screen.getByRole('checkbox', { name: CONSENT })).toBeChecked()
  })

  it('결제수단을 바꾸면 그 결제수단으로 금액을 다시 묻는다', async () => {
    const methods: string[] = []
    server.use(
      http.post(`${API}/orders/quote`, async ({ request }) => {
        methods.push(((await request.json()) as { method: string }).method)
        return HttpResponse.json(quote())
      }),
    )
    const { user } = openAt('/checkout', CART)

    await user.click(await screen.findByRole('radio', { name: '계좌이체' }))

    expect(screen.getByRole('radio', { name: '계좌이체' })).toBeChecked()
    await vi.waitFor(() => expect(methods.at(-1)).toBe('transfer'))
  })
})
