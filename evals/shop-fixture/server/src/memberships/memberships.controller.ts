import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common'
import { UserGuard, UserId } from '../http/user.guard'
import { MembershipsService } from './memberships.service'

@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get('plan')
  plan() {
    return this.memberships.plan()
  }

  @Post()
  @UseGuards(UserGuard)
  join(@UserId() userId: number) {
    return this.memberships.join(userId)
  }

  @Post('me/cancel')
  @HttpCode(200)
  @UseGuards(UserGuard)
  cancel(@UserId() userId: number) {
    return this.memberships.cancel(userId)
  }

  @Post('me/price-consent')
  @UseGuards(UserGuard)
  consentToPrice(@UserId() userId: number) {
    return this.memberships.consentToPrice(userId)
  }
}
