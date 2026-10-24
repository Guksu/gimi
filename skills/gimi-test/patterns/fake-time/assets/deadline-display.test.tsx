import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { API, order, server } from '../test/server'
import { openAt } from '../test/render'

// 기기 시간대를 한국과 날짜가 다른 곳(UTC+14)으로 정한다. 날짜 포맷터는 모듈을 불러올 때 시간대를 굳히므로,
// 모듈보다 먼저(vi.hoisted) 바꾼다. 같은 프로세스의 다른 테스트 파일을 위해 끝나면 되돌린다
const originalTimeZone = vi.hoisted(() => {
  const before = process.env.TZ
  process.env.TZ = 'Pacific/Kiritimati'
  return before
})
afterAll(() => {
  process.env.TZ = originalTimeZone
})
afterEach(() => {
  vi.useRealTimers()
})

const deliveredOrder = (returnDeadline: string) =>
  server.use(http.get(`${API}/orders/7`, () => HttpResponse.json(order({ status: 'delivered', canCancel: false, canReturn: true, returnDeadline, deliveredAt: '2026-10-21T01:00:00.000Z' }))))

describe('반품 마감 표시 — 기기 시간대와 상관없이 한국 날짜', () => {
  it('기기가 한국보다 하루 빠른 시간대여도 마감 날짜는 한국 날짜(10월 28일)다', async () => {
    deliveredOrder('2026-10-28T15:00:00.000Z') // 10월 29일 00:00(KST)부터 막힌다

    openAt('/orders/7')

    expect(await screen.findByText('10월 28일 23:59까지 반품할 수 있어요')).toBeInTheDocument()
  })

  it('달이 바뀌는 마감도 한국 날짜로 보인다 — 10월 31일 23:59', async () => {
    deliveredOrder('2026-10-31T15:00:00.000Z') // 11월 1일 00:00(KST)부터 막힌다

    openAt('/orders/7')

    expect(await screen.findByText('10월 31일 23:59까지 반품할 수 있어요')).toBeInTheDocument()
  })

  it('현재 시각을 고정해도(가짜 Date) 표시는 서버가 준 마감으로만 정해진다', async () => {
    // 화면이 기기 시계로 날짜를 계산하면 이 고정 시각에 따라 표시가 바뀐다
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-31T23:00:00.000Z'))
    deliveredOrder('2026-10-28T15:00:00.000Z')

    openAt('/orders/7')

    expect(await screen.findByText('10월 28일 23:59까지 반품할 수 있어요')).toBeInTheDocument()
  })
})
