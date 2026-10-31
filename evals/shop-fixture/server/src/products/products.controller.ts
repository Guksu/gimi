import { Controller, Get } from '@nestjs/common'
import { Db } from '../db/db'
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from '../money'

@Controller('products')
export class ProductsController {
  constructor(private readonly db: Db) {}

  @Get()
  async list() {
    const rows = (await this.db.pool.query<{ id: string; name: string; price: number; stock: number; returnable: boolean; max_per_order: number }>('SELECT id, name, price, stock, returnable, max_per_order FROM products ORDER BY id')).rows
    return {
      items: rows.map((row) => ({ id: Number(row.id), name: row.name, price: row.price, stock: row.stock, soldOut: row.stock === 0, returnable: row.returnable, maxPerOrder: row.max_per_order })),
      // 첫 화면 가격에 없는 기본 배송비 — 메뉴가 안내한다
      shipping: { fee: SHIPPING_FEE, freeThreshold: FREE_SHIPPING_THRESHOLD },
    }
  }
}
