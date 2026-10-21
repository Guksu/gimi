import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { UserGuard, UserId } from '../http/user.guard'
import { PaymentsService } from './payments.service'

@Controller('payments')
@UseGuards(UserGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('confirm')
  async confirm(@UserId() userId: number, @Body() body: { orderId?: unknown; paymentKey?: unknown; amount?: unknown }, @Res({ passthrough: true }) res: Response) {
    const result = await this.payments.confirm(userId, body)
    res.status(result.status)
    return result.body
  }
}
