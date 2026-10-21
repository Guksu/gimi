import { Injectable, Logger } from '@nestjs/common'
import { AppConfig } from '../config'
import { mask } from '../logging/mask'
import type { Method } from '../money'

export interface PgPayment {
  paymentKey: string
  orderId: string
  method: Method
  status: string
  totalAmount: number
  balanceAmount: number
  approvedAt: string | null
}

/** PG가 거절했다(4xx) 또는 PG 쪽 오류(5xx) */
export class PgError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** 시간을 넘겼거나 연결이 끊겼다 — 결과를 모른다 */
export class PgUnavailable extends Error {}

@Injectable()
export class PgClient {
  private readonly logger = new Logger(PgClient.name)

  constructor(private readonly config: AppConfig) {}

  private async call<T>(path: string, { method, key, body }: { method: 'GET' | 'POST'; key: 'secret' | 'client'; body?: unknown }): Promise<T> {
    const credential = key === 'secret' ? this.config.pgSecretKey : this.config.pgClientKey
    let res: Response
    try {
      res = await fetch(`${this.config.pgBaseUrl}${path}`, {
        method,
        headers: { authorization: `Basic ${Buffer.from(`${credential}:`).toString('base64')}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.pgTimeoutMs),
      })
    } catch (error) {
      this.logger.warn(`PG 호출이 끝나지 않았다 ${method} ${path} ${JSON.stringify(mask(body ?? {}))}`)
      throw new PgUnavailable(error instanceof Error ? error.message : String(error))
    }
    const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
    if (!res.ok) {
      this.logger.warn(`PG가 ${res.status} ${json.code}로 답했다 ${method} ${path} ${JSON.stringify(mask(body ?? {}))}`)
      throw new PgError(res.status, json.code ?? 'UNKNOWN', json.message ?? '')
    }
    return json as T
  }

  createCheckout(input: { orderId: string; amount: number; method: Method; successUrl: string; failUrl: string }) {
    return this.call<{ paymentKey: string; checkoutUrl: string }>('/v1/checkouts', { method: 'POST', key: 'client', body: input })
  }

  confirm(input: { paymentKey: string; orderId: string; amount: number }) {
    return this.call<PgPayment>('/v1/payments/confirm', { method: 'POST', key: 'secret', body: input })
  }

  lookup(paymentKey: string) {
    return this.call<PgPayment>(`/v1/payments/${encodeURIComponent(paymentKey)}`, { method: 'GET', key: 'secret' })
  }

  cancel(paymentKey: string, input: { cancelAmount?: number; refundableAmount?: number; cancelReason: string }) {
    return this.call<PgPayment>(`/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, { method: 'POST', key: 'secret', body: input })
  }
}
