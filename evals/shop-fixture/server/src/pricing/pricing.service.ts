import { Injectable } from '@nestjs/common'
import { Clock } from '../clock'
import { Db, type Queryable } from '../db/db'
import { fail } from '../http/errors'
import { FREE_SHIPPING_THRESHOLD, METHODS, MINIMUM_PAYMENT, POINT_UNIT, SHIPPING_FEE, discountByRate, type Method } from '../money'

export interface QuoteInput {
  items?: unknown
  couponCode?: unknown
  points?: unknown
  method?: unknown
}

export interface QuoteLine {
  productId: number
  name: string
  unitPrice: number
  quantity: number
  lineTotal: number
  returnable: boolean
}

export interface Quote {
  lines: QuoteLine[]
  subtotal: number
  couponCode: string | null
  couponDiscount: number
  pointsUsed: number
  shippingFee: number
  total: number
  freeShippingThreshold: number
  method: Method
}

interface ProductRow {
  id: string
  name: string
  price: number
  stock: number
  max_per_order: number
  returnable: boolean
}

const parseItems = (items: unknown) => {
  if (!Array.isArray(items) || items.length === 0) throw fail(400, 'EMPTY_ORDER', '담은 상품이 없다')
  const seen = new Set<number>()
  return items.map((item: { productId?: unknown; quantity?: unknown }) => {
    const productId = item?.productId
    const quantity = item?.quantity
    if (!Number.isSafeInteger(productId)) throw fail(400, 'INVALID_PRODUCT', '상품 번호가 틀렸다')
    // 수량은 양의 정수만 — 문자열·소수·0·음수는 받지 않는다
    if (!Number.isSafeInteger(quantity) || (quantity as number) < 1) throw fail(400, 'INVALID_QUANTITY', '수량은 1 이상의 정수다')
    if (seen.has(productId as number)) throw fail(400, 'DUPLICATE_ITEM', '같은 상품이 두 줄이다')
    seen.add(productId as number)
    return { productId: productId as number, quantity: quantity as number }
  })
}

const parseMethod = (method: unknown): Method => {
  if (!METHODS.includes(method as Method)) throw fail(400, 'INVALID_METHOD', `결제수단은 ${METHODS.join(', ')} 중 하나다`)
  return method as Method
}

@Injectable()
export class PricingService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /**
   * 결제 금액 계산 — 화면과 주문이 모두 이 함수를 쓴다. 할인 순서는 쿠폰 → 포인트이고, 배송비는 쿠폰 할인 뒤 금액으로 정한다.
   * q를 넘기면 그 트랜잭션 안에서 읽는다
   */
  async quote(userId: number, input: QuoteInput, q: Queryable = this.db.pool): Promise<Quote> {
    const method = parseMethod(input.method)
    const items = parseItems(input.items)
    const rows = (await q.query<ProductRow>('SELECT id, name, price, stock, max_per_order, returnable FROM products WHERE id = ANY($1::bigint[])', [items.map((i) => i.productId)])).rows
    const lines = items.map(({ productId, quantity }) => {
      const product = rows.find((row) => Number(row.id) === productId)
      if (!product) throw fail(400, 'PRODUCT_NOT_FOUND', `상품 ${productId}이 없다`)
      if (quantity > product.max_per_order) throw fail(400, 'INVALID_QUANTITY', `${product.name}은 한 번에 ${product.max_per_order}개까지 살 수 있다`)
      if (product.stock === 0) throw fail(409, 'SOLD_OUT', `${product.name}은 품절이다`)
      if (quantity > product.stock) throw fail(409, 'OUT_OF_STOCK', `${product.name}의 재고가 ${product.stock}개다`)
      return { productId, name: product.name, unitPrice: product.price, quantity, lineTotal: product.price * quantity, returnable: product.returnable }
    })
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)

    const couponCode = typeof input.couponCode === 'string' && input.couponCode.trim() !== '' ? input.couponCode.trim() : null
    const couponDiscount = couponCode ? await this.couponDiscount({ q, userId, code: couponCode, subtotal }) : 0
    const afterCoupon = subtotal - couponDiscount
    const shippingFee = afterCoupon >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE

    const pointsUsed = await this.points({ q, userId, points: input.points, payable: afterCoupon + shippingFee })
    const total = afterCoupon + shippingFee - pointsUsed
    // 0원은 PG를 거치지 않는다. 0원이 아니면 결제수단의 최소 금액을 넘어야 한다
    if (total > 0 && total < MINIMUM_PAYMENT[method]) throw fail(400, 'BELOW_MINIMUM_AMOUNT', `${method} 결제는 ${MINIMUM_PAYMENT[method]}원 이상이다`)
    return { lines, subtotal, couponCode, couponDiscount, pointsUsed, shippingFee, total, freeShippingThreshold: FREE_SHIPPING_THRESHOLD, method }
  }

  private async couponDiscount({ q, userId, code, subtotal }: { q: Queryable; userId: number; code: string; subtotal: number }) {
    const coupon = (await q.query<{ kind: 'fixed' | 'rate'; value: number; min_order: number; starts_at: Date; ends_at: Date; max_uses: number; used_count: number }>('SELECT kind, value, min_order, starts_at, ends_at, max_uses, used_count FROM coupons WHERE code = $1', [code])).rows[0]
    if (!coupon) throw fail(400, 'COUPON_NOT_FOUND', '없는 쿠폰이다')
    const now = this.clock.now().getTime()
    // 쓸 수 있는 기간은 [시작, 끝) — UTC 시각으로 비교한다
    if (now < coupon.starts_at.getTime() || now >= coupon.ends_at.getTime()) throw fail(400, 'COUPON_OUT_OF_PERIOD', '쓸 수 있는 기간이 아니다')
    if (subtotal < coupon.min_order) throw fail(400, 'COUPON_MIN_ORDER', `${coupon.min_order}원 이상 주문에 쓴다`)
    if (coupon.used_count >= coupon.max_uses) throw fail(409, 'COUPON_EXHAUSTED', '쿠폰이 모두 쓰였다')
    const used = await q.query('SELECT 1 FROM coupon_uses WHERE coupon_code = $1 AND user_id = $2', [code, userId])
    if ((used.rowCount ?? 0) > 0) throw fail(409, 'COUPON_ALREADY_USED', '이미 쓴 쿠폰이다')
    // 할인은 상품 금액을 넘지 않는다 — 결제 금액이 음수가 되지 않게
    return coupon.kind === 'fixed' ? Math.min(coupon.value, subtotal) : discountByRate(subtotal, coupon.value)
  }

  private async points({ q, userId, points, payable }: { q: Queryable; userId: number; points: unknown; payable: number }) {
    if (points === undefined || points === null || points === 0) return 0
    if (!Number.isSafeInteger(points) || (points as number) < 0) throw fail(400, 'INVALID_POINTS', '포인트는 0 이상의 정수다')
    if ((points as number) % POINT_UNIT !== 0) throw fail(400, 'POINTS_UNIT', `포인트는 ${POINT_UNIT}점 단위로 쓴다`)
    const balance = (await q.query<{ points: number }>('SELECT points FROM users WHERE id = $1', [userId])).rows[0]?.points ?? 0
    if ((points as number) > balance) throw fail(400, 'POINTS_EXCEED_BALANCE', `보유 포인트는 ${balance}점이다`)
    if ((points as number) > payable) throw fail(400, 'POINTS_EXCEED_PAYABLE', '결제할 금액보다 많이 쓸 수 없다')
    return points as number
  }
}
