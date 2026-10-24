import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { API, order, server } from '../test/server'
import { openAt } from '../test/render'

// 슬롭 — 테스트를 한국 시간대로 고정해 버린다. 개발자 컴퓨터와 같은 시간대에서만 돌아서,
// 화면이 기기 시간대로 날짜를 계산해도 한국 손님과 같은 결과가 나와 통과한다
const originalTimeZone = vi.hoisted(() => {
  const before = process.env.TZ
  process.env.TZ = 'Asia/Seoul'
  return before
})
afterAll(() => {
  process.env.TZ = originalTimeZone
})

describe('반품 마감 표시', () => {
  it('마감 날짜를 보인다', async () => {
    server.use(http.get(`${API}/orders/7`, () => HttpResponse.json(order({ status: 'delivered', canCancel: false, canReturn: true, returnDeadline: '2026-10-28T15:00:00.000Z', deliveredAt: '2026-10-21T01:00:00.000Z' }))))

    openAt('/orders/7')

    expect(await screen.findByText('10월 28일 23:59까지 반품할 수 있어요')).toBeInTheDocument()
  })
})
