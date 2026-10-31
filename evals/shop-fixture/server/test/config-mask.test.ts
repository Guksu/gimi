import { describe, expect, it } from 'vitest'
import { AppConfig } from '../src/config'
import { mask } from '../src/logging/mask'

describe('AppConfig', () => {
  it('시크릿이 없으면 시작할 때 실패한다 — 기본값으로 뜨지 않는다', () => {
    const env = { DATABASE_URL: 'postgres://x', PG_BASE_URL: 'http://pg', PG_CLIENT_KEY: 'c', PG_WEBHOOK_SECRET: 'w', WEB_BASE_URL: 'http://web', REFUND_ACCOUNT_KEY: 'k' }
    const saved = { ...process.env }
    Object.assign(process.env, env)
    delete process.env.PG_SECRET_KEY
    try {
      expect(() => new AppConfig()).toThrow(/PG_SECRET_KEY/)
      process.env.PG_SECRET_KEY = 's'
      expect(new AppConfig().pgSecretKey).toBe('s')
    } finally {
      process.env = saved
    }
  })
})

describe('mask — 로그에 남기기 전에 가린다', () => {
  it('카드번호는 앞 6자리·뒤 4자리만, CVC는 지우고, 키·토큰·인증 머리는 가린다 — 중첩까지', () => {
    expect(
      mask({
        cardNumber: '9410123412341234',
        cvc: '123',
        authorization: 'Basic abc',
        nested: { secretKey: 'test_sk', paymentKey: 'pay_1', amount: 1000 },
        list: [{ token: 't' }],
      }),
    ).toEqual({ cardNumber: '941012******1234', authorization: '***', nested: { secretKey: '***', paymentKey: '***', amount: 1000 }, list: [{ token: '***' }] })
  })
})
