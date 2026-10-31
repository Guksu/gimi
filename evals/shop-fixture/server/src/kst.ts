/**
 * 한국 시간(UTC+9, 서머타임 없음) — 서버의 시간대와 상관없이 같은 값을 낸다
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const shifted = (at: Date) => new Date(at.getTime() + KST_OFFSET_MS)

/** 한국 시간의 시(0~23) */
export const kstHour = (at: Date) => shifted(at).getUTCHours()

/** 한국 날짜 'YYYY-MM-DD' */
export const kstDate = (at: Date) => shifted(at).toISOString().slice(0, 10)

/** 한국 날짜에 해(年)를 더한다 — 2월 29일은 그해에 없으면 3월 1일이 된다 */
export const addYears = (date: string, years: number) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10)
}

/** 만 나이 — 생일 당일(한국 날짜)부터 한 살을 더한다 */
export const ageOn = (birthDate: string, at: Date) => {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number]
  const [y, m, d] = kstDate(at).split('-').map(Number) as [number, number, number]
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}
