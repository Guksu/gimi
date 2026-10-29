import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SEED } from '../db/migrate'
import { TEST_URL } from './global-setup'

const DIR = join(__dirname, '../db/migrations')
const MIGRATIONS = readdirSync(DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort()
// 다른 테스트가 쓰는 스키마와 섞이지 않게 따로 만든다
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

// 마이그레이션 하나를 앱과 같은 방식(트랜잭션 하나)으로 올린다
const apply = async (name: string) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(readFileSync(join(DIR, name), 'utf8'))
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw new Error(`${name}: ${(error as Error).message}`)
  } finally {
    client.release()
  }
}

// 운영 DB처럼 주문이 쌓인 상태 — 첫 마이그레이션에 있던 열만 쓴다
const fillLikeProduction = async () => {
  await pool.query(SEED)
  await pool.query(
    "INSERT INTO orders (user_id, idempotency_key, status, method, subtotal, total) VALUES (1, 'old-1', 'delivered', 'card', 12000, 15000), (2, 'old-2', 'cancelled', 'transfer', 7000, 10000)",
  )
}

describe('마이그레이션은 데이터가 있는 DB에 올린다', () => {
  it('첫 마이그레이션 뒤에 주문을 넣고 나머지를 하나씩 올려도 실패하지 않고, 있던 주문이 그대로 남는다', async () => {
    const [first, ...rest] = MIGRATIONS
    await apply(first as string)
    await fillLikeProduction()

    for (const name of rest) await apply(name)

    const orders = (await pool.query('SELECT idempotency_key, status, total FROM orders ORDER BY id')).rows
    expect(orders).toEqual([
      { idempotency_key: 'old-1', status: 'delivered', total: 15000 },
      { idempotency_key: 'old-2', status: 'cancelled', total: 10000 },
    ])
  })
})
