import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cartTotal } from './cart'
import { openCart } from './test-utils'

// 좋은 예시 — check.mjs의 테스트 슬롭 검사가 아무것도 찾지 않는다
describe('장바구니', () => {
  it('합계는 단가 × 수량의 합이다 — 6,000원 2개와 3,000원 1개는 15,000원', () => {
    expect(cartTotal([{ price: 6000, quantity: 2 }, { price: 3000, quantity: 1 }])).toBe(15000)
  })

  it('담기를 누르면 장바구니 수가 1 늘어난다', async () => {
    const { user } = openCart({ items: [] })

    await user.click(screen.getByRole('button', { name: '잔치국수 담기' }))

    expect(screen.getByRole('link', { name: '장바구니 1' })).toBeInTheDocument()
  })

  it('품절 상품은 담기 버튼이 막혀 있다', async () => {
    openCart({ items: [], soldOut: ['칼국수'] })

    expect(await screen.findByRole('button', { name: '칼국수 품절' })).toBeDisabled()
  })
})
