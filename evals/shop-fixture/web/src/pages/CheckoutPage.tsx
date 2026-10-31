import { useEffect, useRef, useState } from 'react'
import { ApiError, api, type MembershipPlan, type Method, type Quote } from '../api/client'
import { messageOf } from '../api/messages'
import { useCart } from '../cart/cart'
import { formatPrice } from '../money/format'
import { navigate, redirect } from '../navigation'
import { Summary } from './Summary'

const METHODS: { value: Method; label: string }[] = [
  { value: 'card', label: '카드' },
  { value: 'transfer', label: '계좌이체' },
  { value: 'virtual_account', label: '가상계좌' },
]

export const CheckoutPage = () => {
  const cart = useCart()
  const [method, setMethod] = useState<Method>('card')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [plan, setPlan] = useState<MembershipPlan | null>(null)
  const [joinMembership, setJoinMembership] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 이 화면에서 만드는 주문 하나에 멱등 키 하나 — 다시 눌러도 같은 주문이다
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const inFlight = useRef(false)

  useEffect(() => {
    let alive = true
    api
      .quote({ items: cart.items, couponCode: cart.couponCode ?? undefined, points: cart.points || undefined, method })
      .then(({ data }) => alive && setQuote(data))
      .catch((e: unknown) => alive && setError(messageOf(e instanceof ApiError ? e.code : 'UNKNOWN')))
    return () => {
      alive = false
    }
  }, [cart.items, cart.couponCode, cart.points, method])

  useEffect(() => {
    let alive = true
    api
      .membershipPlan()
      .then(({ data }) => alive && setPlan(data))
      // 요금을 못 불러오면 멤버십을 권하지 않는다 — 주문은 그대로 할 수 있다
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const pay = async () => {
    // 버튼 비활성화는 다음 렌더에 반영된다 — 그 사이의 두 번째 클릭을 여기서 막는다
    if (inFlight.current || !quote) return
    inFlight.current = true
    setSubmitting(true)
    try {
      const { data: order } = await api.createOrder({ items: cart.items, couponCode: cart.couponCode ?? undefined, points: cart.points || undefined, method }, idempotencyKey)
      // 멤버십은 손님이 고른 때만 가입한다 — 가입하지 못해도 주문은 이어 간다
      if (joinMembership) await api.joinMembership().catch(() => undefined)
      if (order.status === 'paid') {
        cart.clear()
        navigate(`/orders/${order.id}`)
        return
      }
      const { data: checkout } = await api.checkout(order.id)
      redirect(checkout.checkoutUrl)
    } catch (e) {
      setError(messageOf(e instanceof ApiError ? e.code : 'UNKNOWN'))
      inFlight.current = false
      setSubmitting(false)
    }
  }

  if (cart.items.length === 0) return <p>장바구니가 비어 있어요</p>
  return (
    <section aria-label="주문 확인">
      <h1>주문 확인</h1>
      <fieldset>
        <legend>결제수단</legend>
        {METHODS.map((m) => (
          <label key={m.value}>
            <input type="radio" name="method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} />
            {m.label}
          </label>
        ))}
      </fieldset>
      {quote && <Summary quote={quote} />}
      {error && <p role="alert">{error}</p>}
      {plan && (
        <label>
          {/* 추가 상품은 비워 두고 손님이 직접 고른다 */}
          <input type="checkbox" checked={joinMembership} onChange={(event) => setJoinMembership(event.target.checked)} />
          국수 멤버십도 가입할게요(매달 {formatPrice(plan.price)} 자동 결제)
        </label>
      )}
      <label>
        {/* 동의는 비워 두고 손님이 직접 고른다 */}
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        주문 내용을 확인했고 결제에 동의해요
      </label>
      <button type="button" disabled={!quote || !agreed || submitting} onClick={() => void pay()}>
        {quote ? `${formatPrice(quote.total)} 결제하기` : '결제하기'}
      </button>
    </section>
  )
}
