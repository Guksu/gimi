import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { Pool, type PoolClient } from 'pg'
import { AppConfig } from '../config'

export type Queryable = Pool | PoolClient

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool

  constructor(config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl })
  }

  /** 한 트랜잭션 — 실패하면 모두 되돌린다. 외부 호출(PG)은 이 안에서 하지 않는다 */
  async transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async onModuleDestroy() {
    await this.pool.end()
  }
}

/** 유니크 제약 위반인지 — 같은 요청이 동시에 들어와 하나만 남았을 때 */
export const isUniqueViolation = (error: unknown, constraint: string) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505' && (error as { constraint?: string }).constraint === constraint
