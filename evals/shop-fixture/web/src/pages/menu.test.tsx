import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openAt } from '../test/render'

describe('메뉴', () => {
  it('품절 상품은 담기 버튼이 막혀 있고 품절이라고 보인다', async () => {
    openAt('/')
    const card = (await screen.findByRole('heading', { name: '칼국수' })).closest('article') as HTMLElement
    expect(within(card).getByRole('button', { name: '품절' })).toBeDisabled()
  })

  it('반품 불가 상품에는 상품 화면에 그렇다고 표시한다', async () => {
    openAt('/')
    const card = (await screen.findByRole('heading', { name: '직접 담근 김치 1kg' })).closest('article') as HTMLElement
    expect(within(card).getByText('단순 변심으로 반품할 수 없는 상품이에요')).toBeInTheDocument()
  })

  it('첫 화면에 기본 배송비와 무료 배송 기준을 알린다', async () => {
    openAt('/')
    expect(await screen.findByText('30,000원 미만 주문에는 배송비 3,000원이 붙어요')).toBeInTheDocument()
  })

  it('담으면 장바구니 수가 늘어난다', async () => {
    const { user } = openAt('/')
    const card = (await screen.findByRole('heading', { name: '잔치국수' })).closest('article') as HTMLElement
    await user.click(within(card).getByRole('button', { name: '담기' }))
    expect(screen.getByRole('link', { name: '장바구니 1' })).toBeInTheDocument()
  })
})
