import type { INestApplication } from '@nestjs/common'
import { AppConfig } from './config'

/** 앱 설정 — 실행(main)과 테스트가 함께 쓴다 */
export const configure = (app: INestApplication) => {
  app.enableCors({ origin: app.get(AppConfig).webBaseUrl })
  app.enableShutdownHooks()
  return app
}
