import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { testDatabaseUrl } from "./helpers.js";

interface FloorPlanBody {
  venue: { slug: string; defaultLocale: string; locales: string[] };
  zones: {
    name: string;
    tables: { label: string; shape: string; rotation: number; style: Record<string, unknown> }[];
    issues: { code: string; tableId: string; otherTableId?: string }[];
  }[];
}

const pool = createPool(testDatabaseUrl());
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ pool });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("GET /health", () => {
  it("is ok when the database answers", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    // Port 1 on localhost refuses connections straight away.
    const deadPool = createPool("postgres://nobody@127.0.0.1:1/nothing_test", {
      connectionTimeoutMillis: 1000,
    });
    const deadApp = await buildApp({ pool: deadPool });
    try {
      const response = await deadApp.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "error", database: "unreachable" });
    } finally {
      await deadApp.close();
      await deadPool.end();
    }
  });
});

describe("GET /venues/:slug/floor-plan", () => {
  it("returns the zones and tables in plan order", async () => {
    const response = await app.inject({ method: "GET", url: "/venues/sample-bistro/floor-plan" });
    expect(response.statusCode).toBe(200);

    const body = response.json<FloorPlanBody>();
    expect(body.venue).toMatchObject({
      slug: "sample-bistro",
      defaultLocale: "es",
      locales: ["es", "en", "ar"],
    });
    expect(body.zones.map((zone) => zone.name)).toEqual(["Comedor", "Terraza"]);
    expect(body.zones[0]?.tables.map((table) => table.label)).toEqual(["1", "2", "3", "4"]);
    expect(body.zones[0]?.tables[0]?.style).toEqual({ color: "#c9a46b" });
    expect(body.zones[0]?.tables[3]).toMatchObject({ shape: "rect", rotation: 90 });
    expect(body.zones.every((zone) => zone.issues.length === 0)).toBe(true);
  });

  it("reports plan problems found by the engine", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const venue = await client.query<{ id: string }>(
        `insert into venues (slug, name, time_zone) values ('crowded', 'Crowded', 'Europe/Madrid')
         returning id`,
      );
      const zone = await client.query<{ id: string }>(
        `insert into zones (venue_id, name, width, height) values ($1, 'Room', 400, 300)
         returning id`,
        [venue.rows[0]?.id],
      );
      const tables = await client.query<{ id: string }>(
        `insert into dining_tables (venue_id, zone_id, label, min_seats, max_seats, x, y, width, height)
         values ($1, $2, 'A', 2, 4, 100, 100, 80, 80), ($1, $2, 'B', 2, 4, 140, 100, 80, 80)
         returning id`,
        [venue.rows[0]?.id, zone.rows[0]?.id],
      );
      await client.query("commit");

      const response = await app.inject({ method: "GET", url: "/venues/crowded/floor-plan" });
      expect(response.statusCode).toBe(200);
      expect(response.json<FloorPlanBody>().zones[0]?.issues).toEqual([
        { code: "overlap", tableId: tables.rows[0]?.id, otherTableId: tables.rows[1]?.id },
      ]);
    } finally {
      await client.query("delete from venues where slug = 'crowded'");
      client.release();
    }
  });

  it("hides database details when something breaks", async () => {
    const deadPool = createPool("postgres://nobody@127.0.0.1:1/nothing_test", {
      connectionTimeoutMillis: 1000,
    });
    const deadApp = await buildApp({ pool: deadPool });
    try {
      const response = await deadApp.inject({
        method: "GET",
        url: "/venues/sample-bistro/floor-plan",
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Internal error" });
    } finally {
      await deadApp.close();
      await deadPool.end();
    }
  });

  it("returns 404 for a venue that does not exist", async () => {
    const response = await app.inject({ method: "GET", url: "/venues/nowhere/floor-plan" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Venue not found" });
  });

  it("returns 400 for a malformed slug", async () => {
    const response = await app.inject({ method: "GET", url: "/venues/Not_A_Slug/floor-plan" });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /openapi.json", () => {
  it("describes every route", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);

    const spec = response.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths).sort()).toEqual([
      "/auth/login",
      "/auth/logout",
      "/auth/me",
      "/health",
      "/venues/{slug}/availability",
      "/venues/{slug}/booking-options",
      "/venues/{slug}/booking-rules",
      "/venues/{slug}/floor-plan",
      "/venues/{slug}/reservations",
      "/venues/{slug}/reservations/{id}",
      "/venues/{slug}/tables/{tableId}",
      "/venues/{slug}/zones",
      "/venues/{slug}/zones/{zoneId}",
      "/venues/{slug}/zones/{zoneId}/tables",
    ]);

    // Every route that changes a venue says it needs the staff session cookie.
    const paths = spec.paths as Record<string, Record<string, { security?: unknown }>>;
    const changes = Object.entries(paths).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([method]) => method !== "get" && !path.startsWith("/auth/"))
        .filter(([method]) => !(path.endsWith("/reservations") && method === "post"))
        .map(([method, operation]) => ({ path, method, security: operation.security })),
    );
    expect(changes).toHaveLength(8);
    for (const change of changes) {
      expect(change).toEqual({ ...change, security: [{ staffSession: [] }] });
    }
  });
});
