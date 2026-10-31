import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common'
import { Clock } from '../clock'
import { AppConfig } from '../config'
import { Db } from '../db/db'
import { fail } from '../http/errors'
import { UserGuard, UserId } from '../http/user.guard'
import { encrypt, maskAccount } from '../security/crypto'

/**
 * 가상계좌 환불 계좌 — 입금한 가상계좌 주문을 취소하면 이 계좌로 환불한다. 계좌번호는 암호화해 저장하고, 응답에는 뒤 4자리만 보인다
 */
@Controller('orders/:id/refund-account')
@UseGuards(UserGuard)
export class RefundAccountsController {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  @Post()
  async register(@UserId() userId: number, @Param('id', ParseIntPipe) orderId: number, @Body() body: { bank?: unknown; accountNumber?: unknown; holder?: unknown }) {
    const order = (await this.db.pool.query<{ method: string }>('SELECT method FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId])).rows[0]
    if (!order) throw fail(404, 'ORDER_NOT_FOUND', '주문이 없다')
    if (order.method !== 'virtual_account') throw fail(400, 'NOT_VIRTUAL_ACCOUNT', '가상계좌 주문만 환불 계좌를 받는다')
    const bank = typeof body.bank === 'string' ? body.bank.trim() : ''
    const holder = typeof body.holder === 'string' ? body.holder.trim() : ''
    const accountNumber = typeof body.accountNumber === 'string' ? body.accountNumber.replace(/-/g, '') : ''
    if (!bank || !holder || !/^\d{10,16}$/.test(accountNumber)) throw fail(400, 'INVALID_ACCOUNT', '은행·예금주·계좌번호(숫자 10~16자리)가 필요하다')
    await this.db.pool.query(
      `INSERT INTO refund_accounts (order_id, bank, account_number_enc, holder, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (order_id) DO UPDATE SET bank = EXCLUDED.bank, account_number_enc = EXCLUDED.account_number_enc, holder = EXCLUDED.holder, created_at = EXCLUDED.created_at`,
      [orderId, bank, encrypt(accountNumber, this.config.refundAccountKey), holder, this.clock.now()],
    )
    return { bank, accountNumber: maskAccount(accountNumber), holder }
  }
}
