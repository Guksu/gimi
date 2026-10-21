/**
 * 금액 — 모두 원 단위 정수다. 원 미만이 생기는 계산은 이 파일의 함수에서만 하고, 버린다
 */
export type Method = 'card' | 'transfer' | 'virtual_account'
export const METHODS: readonly Method[] = ['card', 'transfer', 'virtual_account']

// 결제수단별 최소 결제 금액 — PG가 이보다 작은 결제를 받지 않는다
export const MINIMUM_PAYMENT: Record<Method, number> = { card: 100, transfer: 200, virtual_account: 1000 }
export const SHIPPING_FEE = 3000
// 쿠폰 할인 뒤 금액이 이 금액 "이상"이면 배송비가 없다
export const FREE_SHIPPING_THRESHOLD = 30000
export const POINT_UNIT = 10

/** 정률 할인 — 원 미만 버림 */
export const discountByRate = (amount: number, percent: number) => Math.floor((amount * percent) / 100)

/** 결제 금액의 1%를 적립한다 — 원 미만 버림 */
export const pointsToEarn = (paid: number) => Math.floor(paid / 100)
