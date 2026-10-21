import { useEffect, useRef, useState } from 'react'
import { ApiError, api, type Product, type Quote } from '../api/client'
import { messageOf } from '../api/messages'
import { useCart } from '../cart/cart'
import { formatPrice } from '../money/format'
import { navigate } from '../navigation'
import { Summary } from './Summary'

/** 수량 입력 — 1 이상, 상품의 최대 수량 이하의 정수만 */
const parseQuantity = (text: string, max: number) => (/^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= max ? Number(text) : null)

export const CartPage = () => {
  const cart = useCart()
  const [products, setProducts] = useState<Product[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [quote, setQuote] = useState<Quote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [couponText, setCouponText] = useState(cart.couponCode ?? '')
  const latest = useRef(0)

  useEffect(() => {
    void api.products().then(({ data }) => setProducts(data.items))
  }, [])

  const invalid = cart.items.filter((item) => {
    const product = products.find((p) => p.id === item.productId)
    return drafts[item.productId] !== undefined && parseQuantity(drafts[item.productId] ?? '', product?.maxPerOrder ?? 10) === null
  })

  // 금액은 서버가 계산한다 — 늦게 온 옛 응답이 새 결과를 덮지 않게 마지막 요청만 쓴다
  useEffect(() => {
    if (cart.items.length === 0 || invalid.length > 0) return
    const id = ++latest.current
    api
      .quote({ items: cart.items, couponCode: cart.couponCode ?? undefined, points: cart.points || undefined, method: 'card' })
      .then(({ data }) => {
        if (id !== latest.current) return
        setQuote(data)
        setError(null)
      })
      .catch((e: unknown) => {
        if (id !== latest.current) return
        setError(messageOf(e instanceof ApiError ? e.code : 'UNKNOWN'))
      })
  }, [cart.items, cart.couponCode, cart.points, invalid.length])

  if (cart.items.length === 0) return <p>장바구니가 비어 있어요</p>
  const remaining = quote ? quote.freeShippingThreshold - (quote.subtotal - quote.couponDiscount) : 0
  return (
    <section aria-label="장바구니">
      {cart.items.map((item) => {
        const product = products.find((p) => p.id === item.productId)
        const name = product?.name ?? `상품 ${item.productId}`
        const max = product?.maxPerOrder ?? 10
        return (
          <div key={item.productId}>
            <label>
              {name} 수량
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                value={drafts[item.productId] ?? String(item.quantity)}
                onChange={(event) => {
                  const text = event.target.value
                  setDrafts((prev) => ({ ...prev, [item.productId]: text }))
                  const quantity = parseQuantity(text, max)
                  if (quantity !== null) cart.setQuantity(item.productId, quantity)
                }}
              />
            </label>
            <button type="button" onClick={() => cart.remove(item.productId)}>
              {name} 빼기
            </button>
          </div>
        )
      })}
      {invalid.length > 0 && <p role="alert">수량은 1~{products.find((p) => p.id === invalid[0]?.productId)?.maxPerOrder ?? 10}개 사이의 정수로 입력해 주세요</p>}
      <label>
        쿠폰 코드
        <input type="text" value={couponText} onChange={(event) => setCouponText(event.target.value)} />
      </label>
      <button type="button" onClick={() => cart.setCoupon(couponText.trim() || null)}>
        쿠폰 적용
      </button>
      {error && invalid.length === 0 && <p role="alert">{error}</p>}
      {quote && (
        <>
          <Summary quote={quote} />
          {remaining > 0 && <p>{formatPrice(remaining)} 더 담으면 무료 배송이에요</p>}
        </>
      )}
      <button type="button" disabled={!quote || invalid.length > 0 || error !== null} onClick={() => navigate('/checkout')}>
        주문하기
      </button>
    </section>
  )
}
