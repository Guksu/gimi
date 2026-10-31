import { useEffect, useRef, useState } from 'react'
import { ApiError, api, type Order } from '../api/client'
import { messageOf } from '../api/messages'
import { trackPurchase } from '../analytics'
import { useCart } from '../cart/cart'
import { formatPrice } from '../money/format'
import { Link } from '../navigation'

type Result = { kind: 'loading' } | { kind: 'done'; order: Order } | { kind: 'checking' } | { kind: 'failed'; message: string; orderId: number }

/**
 * 결제창에서 돌아온 화면 — 주소의 값으로 서버에 확정을 요청한다. 결제 완료는 서버 응답으로만 보인다(주소의 금액을 믿지 않는다)
 */
export const PaymentSuccessPage = ({ search }: { search: string }) => {
  const cart = useCart()
  const [result, setResult] = useState<Result>({ kind: 'loading' })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const params = new URLSearchParams(search)
    const orderId = Number(params.get('orderId'))
    api
      .confirm({ orderId, paymentKey: params.get('paymentKey') ?? '', amount: Number(params.get('amount')) })
      .then(({ status, data }) => {
        if (status === 202 || !('id' in data)) return setResult({ kind: 'checking' })
        trackPurchase(data)
        cart.clear()
        setResult({ kind: 'done', order: data })
      })
      .catch((e: unknown) => setResult({ kind: 'failed', message: messageOf(e instanceof ApiError ? e.code : 'UNKNOWN'), orderId }))
  }, [search, cart])

  if (result.kind === 'loading') return <p>결제를 마무리하고 있어요</p>
  if (result.kind === 'checking') return <h1>결제를 확인하고 있어요</h1>
  if (result.kind === 'failed')
    return (
      <section>
        <h1>결제하지 못했어요</h1>
        <p role="alert">{result.message}</p>
        <Link to={`/orders/${result.orderId}`}>주문으로 돌아가 다시 결제하기</Link>
      </section>
    )
  return (
    <section>
      <h1>{result.order.status === 'waiting_for_deposit' ? '입금을 기다리고 있어요' : '결제가 끝났어요'}</h1>
      <p>{formatPrice(result.order.total)}</p>
      <Link to={`/orders/${result.order.id}`}>주문 보기</Link>
    </section>
  )
}

export const PaymentFailPage = ({ search }: { search: string }) => {
  const params = new URLSearchParams(search)
  const canceled = params.get('code') === 'USER_CANCEL'
  // 주문번호 없이 돌아오면 돌아갈 주문이 없다 — 메뉴로 보낸다
  const orderId = params.get('orderId')
  return (
    <section>
      <h1>{canceled ? '결제를 취소했어요' : '결제하지 못했어요'}</h1>
      {!canceled && <p role="alert">{messageOf(params.get('code') ?? 'UNKNOWN')}</p>}
      {orderId ? <Link to={`/orders/${orderId}`}>주문으로 돌아가 다시 결제하기</Link> : <Link to="/">메뉴로 돌아가기</Link>}
    </section>
  )
}
