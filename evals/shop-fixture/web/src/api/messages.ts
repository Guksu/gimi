/** 서버 오류 코드 → 화면 문구. 서버가 준 message를 그대로 보이지 않는다 */
const MESSAGES: Record<string, string> = {
  COUPON_NOT_FOUND: '없는 쿠폰이에요',
  COUPON_OUT_OF_PERIOD: '지금은 쓸 수 없는 쿠폰이에요',
  COUPON_MIN_ORDER: '최소 주문 금액을 채우면 쓸 수 있어요',
  COUPON_EXHAUSTED: '쿠폰이 모두 소진됐어요',
  COUPON_ALREADY_USED: '이미 쓴 쿠폰이에요',
  POINTS_UNIT: '포인트는 10점 단위로 쓸 수 있어요',
  POINTS_EXCEED_BALANCE: '보유 포인트보다 많아요',
  POINTS_EXCEED_PAYABLE: '결제할 금액보다 많이 쓸 수 없어요',
  SOLD_OUT: '품절된 상품이 있어요',
  OUT_OF_STOCK: '재고가 모자란 상품이 있어요',
  INVALID_QUANTITY: '수량을 다시 확인해 주세요',
  BELOW_MINIMUM_AMOUNT: '결제 금액이 이 결제수단의 최소 금액보다 작아요',
  NOT_CANCELABLE: '지금은 취소할 수 없는 주문이에요',
  RETURN_WINDOW_CLOSED: '반품 기한이 지났어요',
  NOT_RETURNABLE: '단순 변심으로 반품할 수 없는 상품이에요',
  PAYMENT_REJECTED: '결제가 거절됐어요. 다른 결제수단으로 다시 시도해 주세요',
}

export const messageOf = (code: string) => MESSAGES[code] ?? '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요'
