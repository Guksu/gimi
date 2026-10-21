import { Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { AppConfig } from '../config'
import { Db } from '../db/db'
import { fail } from '../http/errors'
import { PaymentsService } from '../payments/payments.service'
import { verifySignature } from './signature'

interface Event {
  eventId?: string
  type?: string
  data?: { paymentKey?: string }
}

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Db,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * PG 웹훅 — 서명을 확인하고, 같은 이벤트는 한 번만 처리한다. 순서가 바뀌어 와도 PG에 조회한 지금 상태를 반영하므로 결과가 같다.
   * 모르는 type은 기록만 하고 200을 돌려준다(오류로 답하면 PG가 다시 보낸다)
   */
  @Post('pg')
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-fakepg-signature') signature: string | undefined) {
    const raw = req.rawBody?.toString('utf8') ?? ''
    if (!verifySignature(this.config.pgWebhookSecret, raw, signature)) throw fail(401, 'INVALID_SIGNATURE', '서명이 틀렸다')
    const event = JSON.parse(raw) as Event
    if (!event.eventId || !event.type) throw fail(400, 'INVALID_EVENT', '이벤트 형식이 틀렸다')
    const inserted = await this.db.pool.query('INSERT INTO webhook_events (event_id, type, handled) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING', [event.eventId, event.type, 'received'])
    if (inserted.rowCount === 0) return { ok: true, duplicate: true }
    if (event.type !== 'PAYMENT_STATUS_CHANGED' || !event.data?.paymentKey) {
      await this.db.pool.query('UPDATE webhook_events SET handled = $2 WHERE event_id = $1', [event.eventId, 'ignored'])
      return { ok: true }
    }
    const handled = await this.payments.syncFromPg(event.data.paymentKey)
    await this.db.pool.query('UPDATE webhook_events SET handled = $2 WHERE event_id = $1', [event.eventId, handled])
    return { ok: true }
  }
}
