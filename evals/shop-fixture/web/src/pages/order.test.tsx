import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API, order, server } from '../test/server'
import { openAt } from '../test/render'

const show = (body: Record<string, unknown>) => server.use(http.get(`${API}/orders/7`, () => HttpResponse.json(order(body))))

describe('주문 상세', () => {
  it('취소 버튼은 서버가 준 canCancel로 보인다', async () => {
    show({ status: 'preparing', canCancel: true })
    const first = openAt('/orders/7')
    expect(await screen.findByRole('button', { name: '주문 취소' })).toBeInTheDocument()
    first.unmount()
    server.resetHandlers()
    show({ status: 'shipped', canCancel: false })
    openAt('/orders/7')
    await screen.findAllByText('배송 중')
    expect(screen.queryByRole('button', { name: '주문 취소' })).not.toBeInTheDocument()
  })

  it('모르는 상태 값은 "확인 중"으로 보인다', async () => {
    show({ status: 'held_by_risk_team' })
    openAt('/orders/7')
    expect(await screen.findByText('확인 중')).toBeInTheDocument()
  })

  it('반품 기한은 마지막 날(한국 시간)로 보인다', async () => {
    show({ status: 'delivered', canCancel: false, canReturn: true, returnDeadline: '2026-10-28T15:00:00.000Z', deliveredAt: '2026-10-21T01:00:00.000Z' })
    openAt('/orders/7')
    expect(await screen.findByText('10월 28일 23:59까지 반품할 수 있어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '반품 신청' })).toBeInTheDocument()
  })
})
