import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SupplyService } from '../src/orders/supply.service'
import { decrypt } from '../src/security/crypto'
import { REFUND_ACCOUNT_KEY, orderWithCheckout, startApp, type TestApp } from './helpers'

let t: TestApp
beforeEach(async () => {
  t = await startApp()
})
afterEach(async () => {
  await t.close()
})

const paid = async () => {
  const { order, paymentKey } = await orderWithCheckout(t)
  await t.as(1).post('/payments/confirm').send({ orderId: order.id, paymentKey, amount: order.total })
  return order
}

describe('공급 불가', () => {
  it('결제한 주문을 보낼 수 없게 되면 손님에게 바로 알리고 결제한 금액을 모두 환불한다', async () => {
    const order = await paid()
    const after = await t.app.get(SupplyService).markUnavailable(order.id, '재료 수급 중단')
    expect(after).toMatchObject({ status: 'cancelled', refundedAmount: order.total })
    const notes = (await t.db.query('SELECT user_id, order_id, kind, message FROM notifications')).rows
    expect(notes).toEqual([{ user_id: '1', order_id: String(order.id), kind: 'supply_failed', message: '주문하신 상품을 보낼 수 없게 되어 주문을 취소했어요(재료 수급 중단). 결제한 금액은 환불했어요' }])
    // 취소가 되돌린 재고는 보낼 수 없는 재고다
    expect((await t.db.query('SELECT stock FROM products WHERE id = 1')).rows[0].stock).toBe(0)
  })

  it('이미 취소한 주문은 다시 알리지 않는다', async () => {
    const order = await paid()
    const supply = t.app.get(SupplyService)
    await supply.markUnavailable(order.id, '재료 수급 중단')
    await expect(supply.markUnavailable(order.id, '재료 수급 중단')).rejects.toMatchObject({ response: { code: 'NOT_CANCELABLE' } })
    expect((await t.db.query('SELECT count(*) FROM notifications')).rows[0].count).toBe('1')
  })
})

describe('POST /orders/:id/refund-account — 가상계좌 환불 계좌', () => {
  const account = { bank: '국수은행', accountNumber: '110-123-456789', holder: '국수 손님' }

  it('계좌번호는 암호화해 저장하고, 응답에는 뒤 4자리만 보인다', async () => {
    const { order } = await orderWithCheckout(t, { method: 'virtual_account' })
    const res = await t.as(1).post(`/orders/${order.id}/refund-account`).send(account)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ bank: '국수은행', accountNumber: '********6789', holder: '국수 손님' })
    const stored = (await t.db.query('SELECT account_number_enc FROM refund_accounts WHERE order_id = $1', [order.id])).rows[0].account_number_enc
    expect(stored).not.toContain('123456789')
    expect(decrypt(stored, REFUND_ACCOUNT_KEY)).toBe('110123456789')
  })

  it('가상계좌가 아닌 주문과 남의 주문은 받지 않는다', async () => {
    const { order } = await orderWithCheckout(t)
    expect((await t.as(1).post(`/orders/${order.id}/refund-account`).send(account)).body.code).toBe('NOT_VIRTUAL_ACCOUNT')
    expect((await t.as(2).post(`/orders/${order.id}/refund-account`).send(account)).status).toBe(404)
  })
})
