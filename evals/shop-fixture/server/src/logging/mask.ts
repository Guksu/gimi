/**
 * 로그 가리기 — 결제·인증 정보는 로그에 그대로 남기지 않는다. 카드번호는 앞 6자리·뒤 4자리만, CVC는 지운다
 */
const SECRET = /secret|authorization|password|token|paymentkey|apikey/i
const CARD = /^card(?:number|no)$/i
const DROP = /^(?:cvc|cvv)$/i

export const mask = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(mask)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (DROP.test(key)) continue
    if (CARD.test(key) && typeof inner === 'string') out[key] = `${inner.slice(0, 6)}${'*'.repeat(Math.max(0, inner.length - 10))}${inner.slice(-4)}`
    else if (SECRET.test(key)) out[key] = '***'
    else out[key] = mask(inner)
  }
  return out
}
