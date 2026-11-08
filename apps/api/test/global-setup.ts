import { createPool } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";
import { runSeed } from "../src/seed.js";
import { testDatabaseUrl } from "./helpers.js";

/** Starts every test run from an empty database with the migrations and the sample venue. */
export default async function setup(): Promise<void> {
  const pool = createPool(testDatabaseUrl());
  try {
    await pool.query("drop schema if exists public cascade; create schema public;");
    await runMigrations(pool);
    await runSeed(pool);
  } finally {
    await pool.end();
  }
}
