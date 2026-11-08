import type { PoolClient } from "pg";
import type { Pool } from "./db.js";

// Keeps a stuck transaction from holding rows, and a pool connection, for ever.
const LOCK_TIMEOUT = "3s";
const STATEMENT_TIMEOUT = "10s";

// The database waited too long for a lock or a query, or broke a tie between two transactions.
const BUSY_CODES = new Set(["55P03", "57014", "40P01"]);

export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

/** Thrown by `inTransaction` when the database was too busy; routes answer 503. */
export class BusyError extends Error {
  constructor(options?: ErrorOptions) {
    super("Database busy", options);
  }
}

/**
 * Runs `work` in one transaction with short lock and statement timeouts. It commits when `work`
 * returns and rolls back when it throws. Lock waits that run out become a `BusyError`.
 */
export async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const result = await work(client);
    await client.query("commit");
    client.release();
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    // A connection in an unknown state is thrown away instead of going back to the pool.
    client.release(true);
    if (BUSY_CODES.has(errorCode(error))) throw new BusyError({ cause: error });
    throw error;
  }
}
