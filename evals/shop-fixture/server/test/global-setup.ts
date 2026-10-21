/**
 * 테스트 DB 준비 — 개발용 shop DB와 섞이지 않게 shop_test를 따로 만들고, 비운 뒤 마이그레이션을 돌린다
 */
import { Pool } from 'pg'
import { migrate } from '../db/migrate'

export const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://shop@localhost:54329/shop'
export const TEST_URL = ADMIN_URL.replace(/\/[^/]*$/, '/shop_test')

export default async () => {
  const admin = new Pool({ connectionString: ADMIN_URL })
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'shop_test'")
  if (exists.rowCount === 0) await admin.query('CREATE DATABASE shop_test')
  await admin.end()
  const pool = new Pool({ connectionString: TEST_URL })
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public')
  await migrate(pool)
  await pool.end()
}
