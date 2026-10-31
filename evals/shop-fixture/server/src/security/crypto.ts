/**
 * 개인정보 암호화 — AES-256-GCM. 저장 형식은 'iv.tag.본문'(각각 base64)이다
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const keyOf = (base64: string) => {
  const key = Buffer.from(base64, 'base64')
  if (key.length !== 32) throw new Error('암호화 키는 32바이트여야 한다')
  return key
}

export const encrypt = (plain: string, base64Key: string) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyOf(base64Key), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.')
}

export const decrypt = (stored: string, base64Key: string) => {
  const [iv, tag, body] = stored.split('.').map((part) => Buffer.from(part, 'base64')) as [Buffer, Buffer, Buffer]
  const decipher = createDecipheriv('aes-256-gcm', keyOf(base64Key), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

/** 화면·응답에 보이는 계좌번호 — 뒤 4자리만 */
export const maskAccount = (number: string) => `${'*'.repeat(Math.max(0, number.length - 4))}${number.slice(-4)}`
