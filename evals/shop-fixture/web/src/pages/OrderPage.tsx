import { useEffect, useState } from 'react'
import { ApiError, api, type Order } from '../api/client'
import { messageOf } from '../api/messages'
import { formatPrice } from '../money/format'
import { redirect } from '../navigation'

// 모르는 상태 값은 "확인 중"으로 보인다 — 서버가 새 상태를 더해도 화면이 깨지지 않게
const STATUS_LABEL: Record<string, string> = {
  pending_payment: '결제 대기',
  waiting_for_deposit: '입금 대기',
  payment_failed: '결제 실패',
  paid: '결제 완료',
  preparing: '준비 중',
  shipped: '배송 중',
  delivered: '배송 완료',
  partially_refunded: '부분 환불',
  cancelled: '취소됨',
}
const PAYABLE = new Set(['pending_payment', 'payment_failed'])
const KST_DAY = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' })

/** 반품 기한(이 시각부터 막힌다)의 마지막 날 — 한국 시간 */
const lastDay = (deadline: string) => KST_DAY.format(new Date(new Date(deadline).getTime() - 1))

export const OrderPage = ({ id }: { id: number }) => {
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .order(id)
      .then(({ data }) => alive && setOrder(data))
      .catch((e: unknown) => alive && setError(messageOf(e instanceof ApiError ? e.code : 'UNKNOWN')))
    return () => {
      alive = false
    }
  }, [id])

  const run = async (action: () => Promise<{ data: Order } | unknown>) => {
    try {
      const result = (await action()) as { data?: Order }
      setOrder(result.data && 'status' in result.data ? result.data : (await api.order(id)).data)
      setError(null)
    } catch (e) {
      setError(messageOf(e instanceof ApiError ? e.code : 'UNKNOWN'))
    }
  }

  if (!order) return error ? <p role="alert">{error}</p> : <p>주문을 불러오고 있어요</p>
  return (
    <section aria-label="주문 상세">
      <h1>주문 {order.id}</h1>
      <p>{STATUS_LABEL[order.status] ?? '확인 중'}</p>
      <ul>
        {order.items.map((item) => (
          <li key={item.productId}>
            {item.name} × {item.quantity} {formatPrice(item.unitPrice * item.quantity)}
            {!item.returnable && ' (단순 변심 반품 불가)'}
          </li>
        ))}
      </ul>
      <p>결제 금액 {formatPrice(order.total)}</p>
      {order.refundedAmount > 0 && <p>환불한 금액 {formatPrice(order.refundedAmount)}</p>}
      {error && <p role="alert">{error}</p>}
      {PAYABLE.has(order.status) && (
        <button type="button" onClick={() => void api.checkout(order.id).then(({ data }) => redirect(data.checkoutUrl), (e: unknown) => setError(messageOf(e instanceof ApiError ? e.code : 'UNKNOWN')))}>
          결제하기
        </button>
      )}
      {/* 취소·반품 가능 여부는 서버가 정해 준 값으로만 정한다 */}
      {order.canCancel && (
        <button type="button" onClick={() => void run(() => api.cancel(order.id, { reason: '고객 요청' }))}>
          주문 취소
        </button>
      )}
      {order.canReturn && order.returnDeadline && (
        <>
          <p>{lastDay(order.returnDeadline)} 23:59까지 반품할 수 있어요</p>
          <button type="button" onClick={() => void run(() => api.requestReturn(order.id, 'change_of_mind'))}>
            반품 신청
          </button>
        </>
      )}
    </section>
  )
}
