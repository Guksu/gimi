/**
 * 가짜 PG 서버 — 예제 저장소의 결제 시험용. 결제창·승인·조회·취소·웹훅을 흉내 낸다.
 * 실제 PG사의 이름·주소·응답 모양을 따라 하지 않는다. 흐름(결제창 → 승인 → 웹훅, 부분 취소의 잔액 확인)만 비슷하다.
 * behavior로 늦은 응답·거절·오류를, deposit()으로 가상계좌 입금을, sendWebhook()으로 중복·순서 바뀐·모르는 이벤트를 만든다.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export type Method = 'card' | 'transfer' | 'virtual_account'
export type PaymentStatus = 'READY' | 'DONE' | 'WAITING_FOR_DEPOSIT' | 'PARTIAL_CANCELED' | 'CANCELED' | 'ABORTED'

export interface Payment {
  paymentKey: string
  orderId: string
  method: Method
  status: PaymentStatus
  totalAmount: number
  balanceAmount: number
  approvedAt: string | null
  successUrl: string
  failUrl: string
  cancels: { cancelAmount: number; canceledAt: string; cancelReason: string }[]
}

export interface WebhookEvent {
  eventId: string
  type: string
  createdAt: string
  data: { paymentKey: string; orderId: string; status: string }
}

export interface FakePgOptions {
  secretKey: string
  clientKey: string
  webhookSecret: string
  webhookUrl?: string
  port?: number
}

export interface FakePg {
  url: string
  payments: Map<string, Payment>
  behavior: { confirm: 'ok' | 'slow' | 'reject' | 'error'; delayMs: number }
  deposit: (paymentKey: string) => Promise<void>
  sendWebhook: (event: WebhookEvent, options?: { signature?: string }) => Promise<Response>
  flushWebhooks: () => Promise<void>
  /** 웹훅 받을 주소 — 받는 서버가 포트를 연 뒤에 정할 때 쓴다 */
  setWebhookUrl: (url: string) => void
  close: () => Promise<void>
}

// 결제수단별 최소 결제 금액(원)
const MINIMUM: Record<Method, number> = { card: 100, transfer: 200, virtual_account: 1000 }
const METHODS = new Set<Method>(['card', 'transfer', 'virtual_account'])

/** 웹훅 서명 — 본문 그대로의 HMAC-SHA256 */
export const signWebhook = (secret: string, body: string) => `v1=${createHmac('sha256', secret).update(body).digest('hex')}`

/** 서명이 맞는지 — 길이가 다르면 timingSafeEqual이 던지므로 먼저 본다 */
export const verifyWebhook = (secret: string, body: string, signature: string | undefined) => {
  if (!signature) return false
  const expected = Buffer.from(signWebhook(secret, body))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

const send = (res: ServerResponse, status: number, body: unknown) => {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}
const fail = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, { code, message })

const view = (payment: Payment) => {
  const { successUrl: _s, failUrl: _f, ...rest } = payment
  return rest
}

export const createFakePg = async (options: FakePgOptions): Promise<FakePg> => {
  const payments = new Map<string, Payment>()
  const behavior: FakePg['behavior'] = { confirm: 'ok', delayMs: 0 }
  const pending = new Set<Promise<unknown>>()
  let webhookUrl = options.webhookUrl

  const authorized = (req: IncomingMessage, key: string) => req.headers.authorization === `Basic ${Buffer.from(`${key}:`).toString('base64')}`

  const deliver = (event: WebhookEvent, signature?: string) => {
    if (!webhookUrl) return Promise.resolve(new Response(null, { status: 204 }))
    const body = JSON.stringify(event)
    return fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fakepg-signature': signature ?? signWebhook(options.webhookSecret, body) }, body })
  }
  // 상태가 바뀌면 웹훅을 보낸다 — 응답을 기다리지 않는다(실제 PG처럼 따로 간다)
  const notify = (payment: Payment) => {
    const event: WebhookEvent = { eventId: randomUUID(), type: 'PAYMENT_STATUS_CHANGED', createdAt: new Date().toISOString(), data: { paymentKey: payment.paymentKey, orderId: payment.orderId, status: payment.status } }
    const delivery = deliver(event).catch(() => undefined)
    pending.add(delivery)
    void delivery.finally(() => pending.delete(delivery))
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake-pg')
    const parts = url.pathname.split('/').filter(Boolean)
    try {
      // 결제창 만들기 — 클라이언트 키
      if (req.method === 'POST' && url.pathname === '/v1/checkouts') {
        if (!authorized(req, options.clientKey)) return fail(res, 401, 'UNAUTHORIZED_KEY', '클라이언트 키가 틀렸다')
        const body = JSON.parse(await readBody(req)) as { orderId?: string; amount?: number; method?: Method; successUrl?: string; failUrl?: string }
        if (!body.orderId || !Number.isInteger(body.amount) || !body.method || !METHODS.has(body.method) || !body.successUrl || !body.failUrl) return fail(res, 400, 'INVALID_REQUEST', '주문번호·금액(정수)·결제수단·돌아갈 주소가 필요하다')
        if ((body.amount as number) < MINIMUM[body.method]) return fail(res, 400, 'BELOW_MINIMUM_AMOUNT', `${body.method}의 최소 결제 금액은 ${MINIMUM[body.method]}원이다`)
        const payment: Payment = {
          paymentKey: `pay_${randomUUID().replace(/-/g, '')}`,
          orderId: body.orderId,
          method: body.method,
          status: 'READY',
          totalAmount: body.amount as number,
          balanceAmount: body.amount as number,
          approvedAt: null,
          successUrl: body.successUrl,
          failUrl: body.failUrl,
          cancels: [],
        }
        payments.set(payment.paymentKey, payment)
        return send(res, 201, { paymentKey: payment.paymentKey, checkoutUrl: `${base}/checkout/${payment.paymentKey}` })
      }

      // 결제창 — 결제하기·취소 버튼만 있는 페이지
      if (req.method === 'GET' && parts[0] === 'checkout' && parts[1]) {
        const payment = payments.get(parts[1])
        if (!payment) return fail(res, 404, 'NOT_FOUND_PAYMENT', '결제창이 없다')
        const ok = `${payment.successUrl}?paymentKey=${payment.paymentKey}&orderId=${encodeURIComponent(payment.orderId)}&amount=${payment.totalAmount}`
        const no = `${payment.failUrl}?code=USER_CANCEL&orderId=${encodeURIComponent(payment.orderId)}`
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(`<!doctype html><meta charset="utf-8"><title>가짜 결제창</title><h1>${payment.totalAmount}원 결제</h1><a href="${escapeHtml(ok)}">결제하기</a> <a href="${escapeHtml(no)}">취소</a>`)
      }

      // 아래는 시크릿 키가 필요하다
      if (url.pathname.startsWith('/v1/payments') && !authorized(req, options.secretKey)) return fail(res, 401, 'UNAUTHORIZED_KEY', '시크릿 키가 틀렸다')

      if (req.method === 'POST' && url.pathname === '/v1/payments/confirm') {
        const body = JSON.parse(await readBody(req)) as { paymentKey?: string; orderId?: string; amount?: number }
        const payment = body.paymentKey ? payments.get(body.paymentKey) : undefined
        if (!payment || payment.orderId !== body.orderId) return fail(res, 404, 'NOT_FOUND_PAYMENT', '결제가 없다')
        if (payment.status !== 'READY') return fail(res, 400, 'ALREADY_PROCESSED_PAYMENT', '이미 처리한 결제다')
        if (payment.totalAmount !== body.amount) return fail(res, 400, 'AMOUNT_MISMATCH', '결제창 금액과 다르다')
        if (behavior.confirm === 'error') return fail(res, 500, 'PG_INTERNAL_ERROR', 'PG 오류')
        if (behavior.confirm === 'reject') {
          payment.status = 'ABORTED'
          return fail(res, 400, 'REJECT_CARD_PAYMENT', '카드사가 거절했다')
        }
        payment.status = payment.method === 'virtual_account' ? 'WAITING_FOR_DEPOSIT' : 'DONE'
        payment.approvedAt = payment.status === 'DONE' ? new Date().toISOString() : null
        notify(payment)
        // 늦은 응답 — 승인은 이미 끝났는데 응답만 늦다(호출한 쪽은 결과를 모른다)
        if (behavior.confirm === 'slow') await sleep(behavior.delayMs)
        return send(res, 200, view(payment))
      }

      if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'payments' && parts[2] && parts.length === 3) {
        const payment = payments.get(parts[2])
        return payment ? send(res, 200, view(payment)) : fail(res, 404, 'NOT_FOUND_PAYMENT', '결제가 없다')
      }

      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'payments' && parts[2] && parts[3] === 'cancel') {
        const payment = payments.get(parts[2])
        if (!payment) return fail(res, 404, 'NOT_FOUND_PAYMENT', '결제가 없다')
        const body = JSON.parse(await readBody(req)) as { cancelAmount?: number; refundableAmount?: number; cancelReason?: string }
        if (!['DONE', 'PARTIAL_CANCELED', 'WAITING_FOR_DEPOSIT'].includes(payment.status)) return fail(res, 400, 'NOT_CANCELABLE_PAYMENT', '취소할 수 없는 상태다')
        if (body.refundableAmount !== undefined && body.refundableAmount !== payment.balanceAmount) return fail(res, 400, 'REFUNDABLE_AMOUNT_MISMATCH', '남은 금액이 다르다')
        const amount = body.cancelAmount ?? payment.balanceAmount
        if (!Number.isInteger(amount) || amount <= 0) return fail(res, 400, 'INVALID_CANCEL_AMOUNT', '취소 금액은 양의 정수다')
        if (amount > payment.balanceAmount) return fail(res, 400, 'EXCEED_CANCEL_AMOUNT', '남은 금액보다 많다')
        payment.balanceAmount -= amount
        payment.cancels.push({ cancelAmount: amount, canceledAt: new Date().toISOString(), cancelReason: body.cancelReason ?? '' })
        payment.status = payment.balanceAmount === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
        notify(payment)
        return send(res, 200, view(payment))
      }

      return fail(res, 404, 'NOT_FOUND', '없는 주소')
    } catch (error) {
      return fail(res, 400, 'INVALID_REQUEST', error instanceof Error ? error.message : String(error))
    }
  })

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const address = server.address()
  const base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''

  return {
    url: base,
    payments,
    behavior,
    deposit: async (paymentKey) => {
      const payment = payments.get(paymentKey)
      if (!payment || payment.status !== 'WAITING_FOR_DEPOSIT') throw new Error(`입금 대기가 아닌 결제 ${paymentKey}`)
      payment.status = 'DONE'
      payment.approvedAt = new Date().toISOString()
      notify(payment)
    },
    sendWebhook: (event, opts) => deliver(event, opts?.signature),
    setWebhookUrl: (url) => {
      webhookUrl = url
    },
    flushWebhooks: async () => {
      while (pending.size > 0) await Promise.all([...pending])
    },
    close: async () => {
      await Promise.all([...pending])
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
