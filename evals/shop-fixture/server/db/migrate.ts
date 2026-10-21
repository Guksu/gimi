/**
 * 마이그레이션 — db/migrations/*.sql을 이름 순서대로 한 번씩 돌린다. --seed면 시드도 넣는다
 *   DATABASE_URL=postgres://shop@localhost:54329/shop npm run migrate -- --seed
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

const DIR = join(__dirname, 'migrations')

export const migrate = async (pool: Pool) => {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((row) => row.name))
  for (const name of readdirSync(DIR).filter((file) => file.endsWith('.sql')).sort()) {
    if (done.has(name)) continue
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(readFileSync(join(DIR, name), 'utf8'))
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

export const SEED = readFileSync(join(__dirname, 'seed.sql'), 'utf8')

if (require.main === module) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('환경 변수 DATABASE_URL이 없다')
  const pool = new Pool({ connectionString: url })
  migrate(pool)
    .then(async () => {
      if (process.argv.includes('--seed')) await pool.query(SEED)
    })
    .finally(() => pool.end())
}
