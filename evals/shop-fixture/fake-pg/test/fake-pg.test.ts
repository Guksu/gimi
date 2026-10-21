import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakePg, signWebhook, type FakePg } from '../src/index.ts'

const keys = { secretKey: 'test_secret_key', clientKey: 'test_client_key', webhookSecret: 'test_webhook_secret' }
const basic = (key: string) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`

/** 웹훅을 받아 두는 작은 서버 */
const startReceiver = async () => {
  const received: { body: string; signature: string | undefined }[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received.push({ body, signature: req.headers['x-fakepg-signature'] as string | undefined })
      res.writeHead(200).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const url = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}/webhooks/pg` : ''
  return { url, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('fake-pg', () => {
  let pg: FakePg
  let receiver: Awaited<ReturnType<typeof startReceiver>>

  beforeEach(async () => {
    receiver = await startReceiver()
    pg = await createFakePg({ ...keys, webhookUrl: receiver.url })
  })
  afterEach(async () => {
    await pg.close()
    await receiver.close()
  })

  const checkout = async (body: Record<string, unknown>) => {
    const res = await fetch(`${pg.url}/v1/checkouts`, {
      method: 'POST',
      headers: { authorization: basic(keys.clientKey), 'content-type': 'application/json' },
      body: JSON.stringify({ successUrl: 'http://shop/ok', failUrl: 'http://shop/fail', ...body }),
    })
    return { status: res.status, json: (await res.json()) as Record<string, any> }
  }
  const confirm = async (body: Record<string, unknown>, key = keys.secretKey) => {
    const res = await fetch(`${pg.url}/v1/payments/confirm`, { method: 'POST', headers: { authorization: basic(key), 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, json: (await res.json()) as Record<string, any> }
  }
  const cancel = (paymentKey: string, body: Record<string, unknown>) =>
    fetch(`${pg.url}/v1/payments/${paymentKey}/cancel`, {
      method: 'POST',
      headers: { authorization: basic(keys.secretKey), 'content-type': 'application/json' },
      body: JSON.stringify({ cancelReason: '부분 환불', ...body }),
    }).then(async (r) => ({ status: r.status, json: (await r.json()) as Record<string, any> }))

  it('결제창을 만들고 승인하면 DONE이 된다 — 결제창은 성공·실패 주소로 돌아가는 페이지다', async () => {
    const created = await checkout({ orderId: 'o-1', amount: 15000, method: 'card' })
    expect(created.status).toBe(201)
    const page = await (await fetch(created.json.checkoutUrl)).text()
    expect(page).toContain(`http://shop/ok?paymentKey=${created.json.paymentKey}&amp;orderId=o-1&amp;amount=15000`)
    expect(page).toContain('http://shop/fail?code=USER_CANCEL&amp;orderId=o-1')

    const done = await confirm({ paymentKey: created.json.paymentKey, orderId: 'o-1', amount: 15000 })
    expect(done.status).toBe(200)
    expect(done.json).toMatchObject({ status: 'DONE', totalAmount: 15000, balanceAmount: 15000, method: 'card' })
  })

  it('결제창 금액과 다른 금액·틀린 키·두 번째 승인·결제수단별 최소 금액 미달은 거절한다', async () => {
    const { json } = await checkout({ orderId: 'o-2', amount: 15000, method: 'card' })
    expect((await confirm({ paymentKey: json.paymentKey, orderId: 'o-2', amount: 100 })).json.code).toBe('AMOUNT_MISMATCH')
    expect((await confirm({ paymentKey: json.paymentKey, orderId: 'o-2', amount: 15000 }, 'wrong')).status).toBe(401)
    await confirm({ paymentKey: json.paymentKey, orderId: 'o-2', amount: 15000 })
    expect((await confirm({ paymentKey: json.paymentKey, orderId: 'o-2', amount: 15000 })).json.code).toBe('ALREADY_PROCESSED_PAYMENT')
    expect((await checkout({ orderId: 'o-3', amount: 99, method: 'card' })).json.code).toBe('BELOW_MINIMUM_AMOUNT')
    expect((await checkout({ orderId: 'o-4', amount: 199, method: 'transfer' })).json.code).toBe('BELOW_MINIMUM_AMOUNT')
  })

  it('승인을 늦게 돌려주게 하면 결제는 이미 DONE이고 조회로 확인할 수 있다', async () => {
    const { json } = await checkout({ orderId: 'o-5', amount: 8000, method: 'card' })
    pg.behavior.confirm = 'slow'
    pg.behavior.delayMs = 300
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)
    await expect(
      fetch(`${pg.url}/v1/payments/confirm`, {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: basic(keys.secretKey), 'content-type': 'application/json' },
        body: JSON.stringify({ paymentKey: json.paymentKey, orderId: 'o-5', amount: 8000 }),
      }),
    ).rejects.toThrow()
    const looked = await fetch(`${pg.url}/v1/payments/${json.paymentKey}`, { headers: { authorization: basic(keys.secretKey) } })
    expect((await looked.json()).status).toBe('DONE')
  })

  it('승인 거절과 PG 오류를 흉내 낸다', async () => {
    const a = await checkout({ orderId: 'o-6', amount: 8000, method: 'card' })
    pg.behavior.confirm = 'reject'
    expect((await confirm({ paymentKey: a.json.paymentKey, orderId: 'o-6', amount: 8000 })).json.code).toBe('REJECT_CARD_PAYMENT')
    const b = await checkout({ orderId: 'o-7', amount: 8000, method: 'card' })
    pg.behavior.confirm = 'error'
    expect((await confirm({ paymentKey: b.json.paymentKey, orderId: 'o-7', amount: 8000 })).status).toBe(500)
  })

  it('부분 취소는 남은 금액(refundableAmount)이 맞아야 하고, 상태가 바뀔 때마다 서명한 웹훅을 보낸다', async () => {
    const { json } = await checkout({ orderId: 'o-8', amount: 20000, method: 'card' })
    await confirm({ paymentKey: json.paymentKey, orderId: 'o-8', amount: 20000 })
    expect((await cancel(json.paymentKey, { cancelAmount: 5000, refundableAmount: 19000 })).json.code).toBe('REFUNDABLE_AMOUNT_MISMATCH')
    expect((await cancel(json.paymentKey, { cancelAmount: 5000, refundableAmount: 20000 })).json).toMatchObject({ status: 'PARTIAL_CANCELED', balanceAmount: 15000 })
    expect((await cancel(json.paymentKey, { cancelAmount: 16000, refundableAmount: 15000 })).json.code).toBe('EXCEED_CANCEL_AMOUNT')
    expect((await cancel(json.paymentKey, { refundableAmount: 15000 })).json).toMatchObject({ status: 'CANCELED', balanceAmount: 0 })

    await pg.flushWebhooks()
    expect(receiver.received.map((r) => JSON.parse(r.body).data.status)).toEqual(['DONE', 'PARTIAL_CANCELED', 'CANCELED'])
    for (const r of receiver.received) expect(r.signature).toBe(signWebhook(keys.webhookSecret, r.body))
  })

  it('가상계좌는 승인하면 입금 대기이고, 입금하면 DONE이 되어 웹훅이 간다', async () => {
    const { json } = await checkout({ orderId: 'o-9', amount: 30000, method: 'virtual_account' })
    expect((await confirm({ paymentKey: json.paymentKey, orderId: 'o-9', amount: 30000 })).json.status).toBe('WAITING_FOR_DEPOSIT')
    await pg.deposit(json.paymentKey)
    await pg.flushWebhooks()
    expect(receiver.received.map((r) => JSON.parse(r.body).data.status)).toEqual(['WAITING_FOR_DEPOSIT', 'DONE'])
  })

  it('웹훅을 직접 보낼 수 있다 — 같은 이벤트 두 번·순서 바꾸기·모르는 type·틀린 서명을 시험한다', async () => {
    const event = { eventId: 'evt-1', type: 'SOMETHING_NEW', createdAt: '2026-10-21T00:00:00.000Z', data: { paymentKey: 'p', orderId: 'o', status: 'DONE' } }
    expect((await pg.sendWebhook(event)).status).toBe(200)
    expect((await pg.sendWebhook(event, { signature: 'v1=bad' })).status).toBe(200)
    expect(receiver.received.map((r) => r.signature)).toEqual([signWebhook(keys.webhookSecret, JSON.stringify(event)), 'v1=bad'])
  })
})
