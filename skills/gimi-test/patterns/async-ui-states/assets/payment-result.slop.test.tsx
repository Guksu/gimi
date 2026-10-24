import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API, order, server } from '../test/server'
import { openAt } from '../test/render'

// 슬롭 — 성공 응답 하나만 보고, 로딩 문구가 사라졌는지와 제목이 있는지만 확인한다.
// 확인 중·입금 대기·거절 화면은 시험하지 않아서, 확인 중을 완료로 보여도 통과한다
describe('결제 결과', () => {
  it('결제 결과 화면이 뜬다', async () => {
    server.use(http.post(`${API}/payments/confirm`, () => HttpResponse.json(order())))
    openAt('/payments/success?paymentKey=pay_1&orderId=7&amount=15000')

    await waitFor(() => expect(screen.queryByText('결제를 마무리하고 있어요')).not.toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByRole('heading')).toBeInTheDocument()
  })
})
