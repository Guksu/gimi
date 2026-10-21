import { Injectable } from '@nestjs/common'

const required = (name: string) => {
  const value = process.env[name]
  // 시크릿에 기본값을 두지 않는다 — 설정이 빠진 채로 뜨지 않게 시작할 때 실패한다
  if (!value) throw new Error(`환경 변수 ${name}이(가) 없다`)
  return value
}

@Injectable()
export class AppConfig {
  readonly databaseUrl = required('DATABASE_URL')
  readonly pgBaseUrl = required('PG_BASE_URL')
  readonly pgSecretKey = required('PG_SECRET_KEY')
  readonly pgClientKey = required('PG_CLIENT_KEY')
  readonly pgWebhookSecret = required('PG_WEBHOOK_SECRET')
  readonly webBaseUrl = required('WEB_BASE_URL')
  // PG 호출의 시간 상한 — 넘기면 결과를 모르는 것으로 보고 조회한다
  readonly pgTimeoutMs = Number(process.env.PG_TIMEOUT_MS ?? 5000)
}
