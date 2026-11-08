import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "./db.js";

export const MIGRATIONS_DIR = new URL("../../../db/migrations/", import.meta.url);

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
// Any fixed number works. It only has to be the same for every copy of this app.
const MIGRATION_LOCK_KEY = 41_002_026;

/**
 * Applies the SQL files in `db/migrations` that have not run yet, in name order, each one in
 * its own transaction. An advisory lock stops two app instances from migrating at once.
 * Returns the files it applied.
 */
export async function runMigrations(pool: Pool, dir: URL = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((name) => MIGRATION_FILE.test(name)).sort();
  const client = await pool.connect();
  let broken = false;

  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );

    const { rows } = await client.query<{ name: string }>("select name from schema_migrations");
    const alreadyApplied = new Set(rows.map((row) => row.name));
    const applied: string[] = [];

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;

      const sql = await readFile(new URL(file, dir), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed`, { cause: error });
      }
      applied.push(file);
    }

    return applied;
  } catch (error) {
    broken = true;
    throw error;
  } finally {
    try {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } catch {
      broken = true;
    }
    // A connection in an unknown state is thrown away instead of going back to the pool.
    client.release(broken);
  }
}
