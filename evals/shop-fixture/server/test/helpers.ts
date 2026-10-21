/**
 * 테스트 앱 — 실제 PostgreSQL(shop_test)과 프로세스 안의 가짜 PG로 앱 전체를 띄운다. 시계는 고정한다
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { createFakePg, type FakePg } from 'fake-pg'
import { Pool } from 'pg'
import request from 'supertest'
import { SEED } from '../db/migrate'
import { AppModule } from '../src/app.module'
import { Clock } from '../src/clock'
import { configure } from '../src/app'
import { TEST_URL } from './global-setup'

export const KEYS = { secretKey: 'test_secret_key', clientKey: 'test_client_key', webhookSecret: 'test_webhook_secret' }
const TABLES = 'returns, webhook_events, payments, coupon_uses, order_items, orders, coupons, products, users'

export class FixedClock extends Clock {
  current = new Date('2026-10-21T03:00:00.000Z')
  override now() {
    return new Date(this.current)
  }
  set(iso: string) {
    this.current = new Date(iso)
  }
}

export interface TestApp {
  app: INestApplication
  pg: FakePg
  db: Pool
  clock: FixedClock
  /** x-user-id를 붙인 요청 */
  as: (userId: number) => {
    get: (path: string) => request.Test
    post: (path: string) => request.Test
  }
  close: () => Promise<void>
}

/**
 * 테스트마다 앱·가짜 PG를 새로 띄우고 표를 비운 뒤 시드를 넣는다.
 * PG 시간 제한은 시간 초과를 시험할 때만 짧게 준다 — 짧은 기본값은 프로세스의 첫 요청이 느린 기계에서 시간을 넘긴다
 */
export const startApp = async ({ pgTimeoutMs = 2000 }: { pgTimeoutMs?: number } = {}): Promise<TestApp> => {
  const pg = await createFakePg(KEYS)
  Object.assign(process.env, {
    DATABASE_URL: TEST_URL,
    PG_BASE_URL: pg.url,
    PG_SECRET_KEY: KEYS.secretKey,
    PG_CLIENT_KEY: KEYS.clientKey,
    PG_WEBHOOK_SECRET: KEYS.webhookSecret,
    PG_TIMEOUT_MS: String(pgTimeoutMs),
    WEB_BASE_URL: 'http://web.test',
  })
  const clock = new FixedClock()
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(Clock).useValue(clock).compile()
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false })
  configure(app)
  await app.listen(0, '127.0.0.1')
  pg.setWebhookUrl(`${await app.getUrl()}/webhooks/pg`.replace('[::1]', '127.0.0.1'))

  const db = new Pool({ connectionString: TEST_URL })
  await db.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`)
  await db.query(SEED)

  const server = app.getHttpServer()
  return {
    app,
    pg,
    db,
    clock,
    as: (userId) => ({
      get: (path) => request(server).get(path).set('x-user-id', String(userId)),
      post: (path) => request(server).post(path).set('x-user-id', String(userId)),
    }),
    close: async () => {
      await pg.flushWebhooks()
      await app.close()
      await pg.close()
      await db.end()
    },
  }
}

/** 주문을 만들고 결제창까지 연 상태 — 결제 흐름 시험의 시작점 */
export const orderWithCheckout = async (t: TestApp, body: Record<string, unknown> = {}, key = 'k-1') => {
  const order = await t
    .as(1)
    .post('/orders')
    .set('idempotency-key', key)
    .send({ items: [{ productId: 1, quantity: 2 }], method: 'card', ...body })
  if (order.status !== 201) throw new Error(`주문 실패 ${order.status} ${JSON.stringify(order.body)}`)
  const checkout = await t.as(1).post(`/orders/${order.body.id}/checkout`)
  if (checkout.status !== 201) throw new Error(`결제창 실패 ${checkout.status} ${JSON.stringify(checkout.body)}`)
  return { order: order.body, paymentKey: checkout.body.paymentKey as string }
}
