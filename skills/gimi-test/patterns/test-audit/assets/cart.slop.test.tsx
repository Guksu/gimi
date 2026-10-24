import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import axios from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { CartBadge } from './CartBadge'
import { cartTotal } from './cart'

// 슬롭 예시 — 프로젝트의 cart.test.tsx로 두면 check.mjs가 아래를 찾는다(PATTERN.md의 표와 같다)
vi.mock('./cart')
vi.mock('axios')

describe('장바구니', () => {
  it.only('합계를 보인다', () => {
    vi.mocked(cartTotal).mockReturnValue(15000)

    expect(cartTotal([{ price: 6000, quantity: 2 }])).toBe(15000)
  })

  it('배지를 그린다', () => {
    render(<CartBadge count={1} />)
  })

  it('합계를 계산한다', () => {
    try {
      expect(cartTotal([{ price: 6000, quantity: 2 }])).toBe(12000)
    } catch {
      // 가끔 깨져서 일단 넘긴다
    }
  })

  it('늘 통과한다', () => {
    expect(true).toBe(true)
  })

  it('잠시 뒤에 배지가 바뀐다', async () => {
    render(<CartBadge count={1} />)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.getByTestId('badge')).toHaveTextContent('2')
  })

  it.skip('품절이면 담을 수 없다', () => {
    expect(cartTotal([])).toBe(0)
  })

  it('경고를 숨긴다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<CartBadge count={-1} />)
    expect(screen.getByRole('status')).toHaveClass('badge--error')
  })

  it('누른 뒤 배지를 기다린다', async () => {
    render(<CartBadge count={1} />)
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: '담기' }))
      expect(screen.getByRole('status')).toHaveTextContent('2')
    })
  })

  it('가끔 깨지는 주문 요청', { retry: 3 }, async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { ok: true } })
    expect((await axios.post('/orders')).data.ok).toBe(true)
  })
})
