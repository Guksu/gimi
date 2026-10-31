/**
 * 시험용 API — MSW로 네트워크 경계에서 바꾼다. 테스트마다 server.use로 응답을 덮는다
 */
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { components } from '../api/schema'

type Order = components['schemas']['Order']
type Product = components['schemas']['Product']
type Quote = components['schemas']['Quote']

export const API = 'http://api.test'

export const products: Product[] = [
  { id: 1, name: '잔치국수', price: 6000, stock: 20, soldOut: false, returnable: true, maxPerOrder: 10 },
  { id: 3, name: '칼국수', price: 8000, stock: 0, soldOut: true, returnable: true, maxPerOrder: 10 },
  { id: 4, name: '직접 담근 김치 1kg', price: 12000, stock: 10, soldOut: false, returnable: false, maxPerOrder: 3 },
]

export const quote = (overrides: Partial<Quote> = {}): Quote => ({
  lines: [{ productId: 1, name: '잔치국수', unitPrice: 6000, quantity: 2, lineTotal: 12000 }],
  subtotal: 12000,
  couponCode: null,
  couponDiscount: 0,
  pointsUsed: 0,
  shippingFee: 3000,
  total: 15000,
  freeShippingThreshold: 30000,
  method: 'card',
  ...overrides,
})

export const order = (overrides: Partial<Order> = {}): Order => ({
  id: 7,
  status: 'paid',
  method: 'card',
  items: [{ productId: 1, name: '잔치국수', unitPrice: 6000, quantity: 2, returnable: true }],
  subtotal: 12000,
  couponDiscount: 0,
  pointsUsed: 0,
  shippingFee: 3000,
  total: 15000,
  pointsEarned: 150,
  refundedAmount: 0,
  refundableAmount: 15000,
  canCancel: true,
  canReturn: false,
  returnDeadline: null,
  createdAt: '2026-10-21T03:00:00.000Z',
  paidAt: '2026-10-21T03:01:00.000Z',
  deliveredAt: null,
  ...overrides,
})

export const server = setupServer(
  http.get(`${API}/products`, () => HttpResponse.json({ items: products, shipping: { fee: 3000, freeThreshold: 30000 } })),
  http.post(`${API}/orders/quote`, () => HttpResponse.json(quote())),
)
