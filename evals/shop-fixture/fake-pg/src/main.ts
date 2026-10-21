/**
 * 개발용 실행 — 웹에서 결제 흐름을 손으로 돌려 볼 때 쓴다. 키는 환경 변수로만 받는다(기본값을 두지 않는다)
 */
import { createFakePg } from './index.ts'

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`환경 변수 ${name}이(가) 없다`)
  return value
}

const pg = await createFakePg({
  port: Number(process.env.FAKE_PG_PORT ?? 4010),
  secretKey: required('PG_SECRET_KEY'),
  clientKey: required('PG_CLIENT_KEY'),
  webhookSecret: required('PG_WEBHOOK_SECRET'),
  webhookUrl: process.env.PG_WEBHOOK_URL,
})
console.info(`fake-pg ${pg.url}`)
