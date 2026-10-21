import { NestFactory } from '@nestjs/core'
import { configure } from './app'
import { AppModule } from './app.module'

const bootstrap = async () => {
  // 웹훅 서명은 본문 그대로로 확인한다 — rawBody를 켠다
  const app = configure(await NestFactory.create(AppModule, { rawBody: true }))
  await app.listen(Number(process.env.PORT ?? 4000))
}

void bootstrap()
