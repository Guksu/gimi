import { Injectable } from '@nestjs/common'

/** 지금 시각 — 테스트가 고정한 시계로 바꾼다 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date()
  }
}
