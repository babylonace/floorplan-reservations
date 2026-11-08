import pg from "pg";

export type Pool = pg.Pool;

export function createPool(connectionString: string, options: pg.PoolConfig = {}): Pool {
  return new pg.Pool({ connectionString, max: 10, ...options });
}
