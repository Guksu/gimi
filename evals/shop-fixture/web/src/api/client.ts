/**
 * server API — 타입은 계약(contracts/openapi.yaml)에서 만든 schema.d.ts를 쓴다(npm run generate:api)
 */
import type { components } from './schema'

export type Product = components['schemas']['Product']
export type Quote = components['schemas']['Quote']
export type Order = components['schemas']['Order']
export type OrderRequest = components['schemas']['OrderRequest']
export type Method = components['schemas']['Method']
export type Checkout = components['schemas']['Checkout']

const BASE = import.meta.env.VITE_API_BASE ?? '/api'
// 예제라 로그인이 없다 — 손님은 1번이다
const USER_ID = '1'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const request = async <T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-user-id': USER_ID, ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { code?: string; message?: string }
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'UNKNOWN', data.message ?? '')
  return { status: res.status, data: data as T }
}

export const api = {
  products: () => request<{ items: Product[] }>('/products'),
  quote: (body: OrderRequest) => request<Quote>('/orders/quote', { method: 'POST', body }),
  createOrder: (body: OrderRequest, idempotencyKey: string) => request<Order>('/orders', { method: 'POST', body, headers: { 'idempotency-key': idempotencyKey } }),
  order: (id: number) => request<Order>(`/orders/${id}`),
  checkout: (id: number) => request<Checkout>(`/orders/${id}/checkout`, { method: 'POST' }),
  confirm: (body: { orderId: number; paymentKey: string; amount: number }) => request<Order | { status: 'checking'; message: string }>('/payments/confirm', { method: 'POST', body }),
  cancel: (id: number, body: { amount?: number; reason: string }) => request<Order>(`/orders/${id}/cancel`, { method: 'POST', body }),
  requestReturn: (id: number, reason: 'change_of_mind' | 'defective') => request<{ id: number; deadline: string }>(`/orders/${id}/returns`, { method: 'POST', body: { reason } }),
}
