import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { orderWithCheckout, startApp, type TestApp } from './helpers'

// 슬롭 — PG 연동 모듈(HTTP 클라이언트)을 mock한다. mock은 늘 바로 승인을 돌려줘서,
// 타임아웃·5xx를 어떻게 처리하든 이 테스트는 통과한다. 실제 HTTP·타임아웃·오류 변환은 한 줄도 돌지 않는다
const pg = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('../src/payments/pg-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/payments/pg-client')>()
  class MockPgClient extends actual.PgClient {
    override confirm(input: Parameters<InstanceType<typeof actual.PgClient>['confirm']>[0]) {
      return pg.confirm(input)
    }
  }
  return { ...actual, PgClient: MockPgClient }
})

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

describe('결제 승인', () => {
  it('PG가 승인하면 결제 완료가 된다', async () => {
    const { order, paymentKey } = await orderWithCheckout(t)
    pg.confirm.mockResolvedValue({ paymentKey, orderId: String(order.id), method: 'card', status: 'DONE', totalAmount: order.total, balanceAmount: order.total, approvedAt: '2026-10-21T03:00:00.000Z' })

    const res = await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: order.total })

    expect(res.body.status).toBe('paid')
    expect(pg.confirm).toHaveBeenCalledWith({ paymentKey, orderId: String(order.id), amount: order.total })
  })
})
