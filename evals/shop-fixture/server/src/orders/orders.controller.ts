import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { UserGuard, UserId } from '../http/user.guard'
import { PricingService, type QuoteInput } from '../pricing/pricing.service'
import { OrdersService } from './orders.service'

@Controller('orders')
@UseGuards(UserGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly pricing: PricingService,
  ) {}

  @Post('quote')
  @HttpCode(200)
  async quote(@UserId() userId: number, @Body() body: QuoteInput) {
    const { lines, ...rest } = await this.pricing.quote(userId, body)
    return { ...rest, lines: lines.map(({ returnable: _, ...line }) => line) }
  }

  @Post()
  async create(@UserId() userId: number, @Headers('idempotency-key') key: string | undefined, @Body() body: QuoteInput, @Res({ passthrough: true }) res: Response) {
    const { order, created } = await this.orders.create(userId, key, body)
    res.status(created ? 201 : 200)
    return order
  }

  @Get()
  list(@UserId() userId: number) {
    return this.orders.list(userId)
  }

  @Get(':id')
  get(@UserId() userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.orders.get(userId, id)
  }

  @Post(':id/checkout')
  checkout(@UserId() userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.orders.checkout(userId, id)
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@UserId() userId: number, @Param('id', ParseIntPipe) id: number, @Body() body: { amount?: unknown; reason?: unknown }) {
    return this.orders.cancel(userId, id, body)
  }

  @Post(':id/returns')
  requestReturn(@UserId() userId: number, @Param('id', ParseIntPipe) id: number, @Body() body: { reason?: unknown }) {
    return this.orders.requestReturn(userId, id, body)
  }
}
