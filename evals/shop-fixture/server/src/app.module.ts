import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { AdsService } from './ads/ads.service'
import { Clock } from './clock'
import { AppConfig } from './config'
import { Db } from './db/db'
import { MembersController } from './members/members.controller'
import { MembersService } from './members/members.service'
import { RetentionService } from './members/retention.service'
import { MembershipsController } from './memberships/memberships.controller'
import { MembershipsService } from './memberships/memberships.service'
import { OrdersController } from './orders/orders.controller'
import { OrdersService } from './orders/orders.service'
import { RefundAccountsController } from './orders/refund-accounts.controller'
import { SupplyService } from './orders/supply.service'
import { PaymentsController } from './payments/payments.controller'
import { PaymentsService } from './payments/payments.service'
import { PgClient } from './payments/pg-client'
import { PricingService } from './pricing/pricing.service'
import { ProductsController } from './products/products.controller'
import { WebhooksController } from './webhooks/webhooks.controller'

@Module({
  controllers: [ProductsController, OrdersController, PaymentsController, WebhooksController, MembersController, RefundAccountsController, MembershipsController],
  providers: [AppConfig, Clock, Db, PricingService, OrdersService, PgClient, PaymentsService, MembersService, RetentionService, AdsService, SupplyService, MembershipsService],
})
export class AppModule {}
