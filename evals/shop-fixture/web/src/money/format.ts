/** 금액 표시 — 화면의 모든 금액이 이 함수를 거친다. 요청에는 포맷하지 않은 정수를 보낸다 */
const NUMBER = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })

export const formatPrice = (won: number) => `${NUMBER.format(won)}원`
