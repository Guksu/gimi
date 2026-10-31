import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { UserGuard, UserId } from '../http/user.guard'
import { MembersService, type SignUpInput } from './members.service'

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Post()
  signUp(@Body() body: SignUpInput) {
    return this.members.signUp(body)
  }

  @Post('me/withdraw')
  @HttpCode(200)
  @UseGuards(UserGuard)
  withdraw(@UserId() userId: number) {
    return this.members.withdraw(userId)
  }
}
