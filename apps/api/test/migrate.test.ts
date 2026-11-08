import { afterAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";
import { runSeed } from "../src/seed.js";
import { SAMPLE_VENUE_ID, testDatabaseUrl } from "./helpers.js";

const pool = createPool(testDatabaseUrl());

afterAll(async () => {
  await pool.end();
});

describe("migrations", () => {
  it("records each applied file", async () => {
    const { rows } = await pool.query<{ name: string }>(
      "select name from schema_migrations order by name",
    );
    expect(rows.map((row) => row.name)).toContain("0001_initial_schema.sql");
  });

  it("does nothing when run again", async () => {
    expect(await runMigrations(pool)).toEqual([]);
  });

  it("survives two app instances migrating at the same time", async () => {
    const results = await Promise.all([runMigrations(pool), runMigrations(pool)]);
    expect(results).toEqual([[], []]);
  });
});

describe("sample seed", () => {
  it("can be loaded twice without duplicating rows", async () => {
    await runSeed(pool);
    const { rows } = await pool.query<{ tables: string }>(
      `select count(*) as tables
         from dining_tables t
         join zones z on z.id = t.zone_id
        where z.venue_id = $1`,
      [SAMPLE_VENUE_ID],
    );
    expect(rows[0]?.tables).toBe("6");
  });
});
