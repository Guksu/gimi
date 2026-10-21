import { createHmac, timingSafeEqual } from 'node:crypto'

/** PG 웹훅 서명 — 본문 그대로의 HMAC-SHA256("v1=" + hex) */
export const verifySignature = (secret: string, rawBody: string, signature: string | undefined) => {
  if (!signature) return false
  const expected = Buffer.from(`v1=${createHmac('sha256', secret).update(rawBody).digest('hex')}`)
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
