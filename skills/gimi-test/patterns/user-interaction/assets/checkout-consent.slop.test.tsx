import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openAt } from '../test/render'

// 슬롭 — 체크박스를 DOM 구조(querySelector)로 찾고 fireEvent로 누른 뒤, 상태가 뒤집혔는지만 본다.
// 처음 상태(비어 있어야 한다)를 보지 않아서, 동의가 미리 켜져 있어도 통과한다
describe('주문 확인', () => {
  it('동의 체크박스를 누르면 체크 상태가 바뀐다', async () => {
    const { container } = openAt('/checkout', [{ productId: 1, quantity: 2 }])
    await screen.findByText('총 결제 금액')
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!

    const before = checkbox.checked
    fireEvent.click(checkbox)

    expect(checkbox.checked).toBe(!before)
  })
})
