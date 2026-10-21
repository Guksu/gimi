import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { Clock } from './clock'
import { AppConfig } from './config'
import { Db } from './db/db'
import { OrdersController } from './orders/orders.controller'
import { OrdersService } from './orders/orders.service'
import { PaymentsController } from './payments/payments.controller'
import { PaymentsService } from './payments/payments.service'
import { PgClient } from './payments/pg-client'
import { PricingService } from './pricing/pricing.service'
import { ProductsController } from './products/products.controller'
import { WebhooksController } from './webhooks/webhooks.controller'

@Module({
  controllers: [ProductsController, OrdersController, PaymentsController, WebhooksController],
  providers: [AppConfig, Clock, Db, PricingService, OrdersService, PgClient, PaymentsService],
})
export class AppModule {}
