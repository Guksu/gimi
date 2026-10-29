import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../db/migrate'
import { TEST_URL } from './global-setup'

const SCHEMA = 'migration_check'

let pool: Pool
beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_URL, options: `-c search_path=${SCHEMA}` })
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`)
})
afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await pool.end()
})

// 슬롭 — 빈 DB에 모두 올리고 표가 생겼는지만 본다. 주문이 있는 DB에서 기본값 없는 NOT NULL이 실패하는 것을 보지 않는다
describe('마이그레이션', () => {
  it('모든 마이그레이션이 올라가고 주문 표가 생긴다', async () => {
    await migrate(pool)

    const orders = await pool.query('SELECT count(*)::int AS n FROM orders')
    expect(orders.rows[0]?.n).toBe(0)
  })
})
