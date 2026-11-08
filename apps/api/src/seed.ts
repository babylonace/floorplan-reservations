import { readFile } from "node:fs/promises";
import type { Pool } from "./db.js";

export const SAMPLE_SEED_FILE = new URL("../../../db/seed/sample.sql", import.meta.url);

/** Loads the made-up sample venue. Safe to run more than once. */
export async function runSeed(pool: Pool, file: URL = SAMPLE_SEED_FILE): Promise<void> {
  const sql = await readFile(file, "utf8");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
