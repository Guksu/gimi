import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const order = (key: string) => t.as(1).post('/orders').set('idempotency-key', key).send({ method: 'card', items: [{ productId: 1, quantity: 1 }] })

// 슬롭 — 순차 호출 두 번. 첫 주문이 끝난 뒤에 두 번째가 오므로 확인과 차감이 원자적이지 않아도 통과한다
describe('재고', () => {
  it('재고가 1개면 두 번째 주문은 실패한다', async () => {
    await t.db.query('UPDATE products SET stock = 1 WHERE id = 1')

    const first = await order('seq-1')
    const second = await order('seq-2')

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
  })
})
