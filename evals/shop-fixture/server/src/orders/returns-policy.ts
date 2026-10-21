/**
 * 청약철회(반품) 기한 — 받은 날은 세지 않고 다음 날부터 7일째 23:59:59(한국 시간)까지다.
 * 날짜 경계는 한국 시간으로 정하고, 비교는 UTC 시각으로 한다
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
export const CHANGE_OF_MIND_DAYS = 7
// 상품 하자는 더 길게 받는다(공급받은 날부터 3개월 — 넉넉히 90일로 둔다)
export const DEFECTIVE_DAYS = 90

/** 그 시각이 되면 반품을 받지 않는다 — 받은 날(한국 시간)의 다음 날부터 days일이 지난 자정 */
export const returnDeadline = (deliveredAt: Date, days = CHANGE_OF_MIND_DAYS) => {
  const kst = new Date(deliveredAt.getTime() + KST_OFFSET_MS)
  const startOfDeliveryDay = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS
  return new Date(startOfDeliveryDay + (days + 1) * DAY_MS)
}
