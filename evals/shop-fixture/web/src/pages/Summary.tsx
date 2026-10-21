import type { Quote } from '../api/client'
import { formatPrice } from '../money/format'

/** 결제 금액 요약 — 서버가 계산한 값만 보인다 */
export const Summary = ({ quote }: { quote: Quote }) => (
  <dl>
    <dt>상품 금액</dt>
    <dd>{formatPrice(quote.subtotal)}</dd>
    {quote.couponDiscount > 0 && (
      <>
        <dt>쿠폰 할인</dt>
        <dd>{formatPrice(-quote.couponDiscount)}</dd>
      </>
    )}
    {quote.pointsUsed > 0 && (
      <>
        <dt>포인트</dt>
        <dd>{formatPrice(-quote.pointsUsed)}</dd>
      </>
    )}
    <dt>배송비</dt>
    <dd>{quote.shippingFee === 0 ? '무료' : formatPrice(quote.shippingFee)}</dd>
    <dt>총 결제 금액</dt>
    <dd>{formatPrice(quote.total)}</dd>
  </dl>
)
