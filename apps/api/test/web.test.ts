import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { CONTENT_SECURITY_POLICY } from "../src/routes/web.js";
import { TEST_APP_OPTIONS, testDatabaseUrl } from "./helpers.js";

const pool = createPool(testDatabaseUrl());
// A parent folder called "assets" must not make index.html look like a hashed asset.
const dir = join(mkdtempSync(join(tmpdir(), "floorplan-web-")), "assets", "dist");
let app: FastifyInstance;

beforeAll(async () => {
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Plan</title>");
  mkdirSync(join(dir, "reservar"), { recursive: true });
  writeFileSync(join(dir, "reservar", "index.html"), "<!doctype html><title>Book</title>");
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1);");
  app = await buildApp({ pool, ...TEST_APP_OPTIONS, webDir: dir });
});

afterAll(async () => {
  await app.close();
  await pool.end();
  rmSync(join(dir, "..", ".."), { recursive: true, force: true });
});

describe("the built web app", () => {
  it("is served at / with a strict content security policy", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.body).toContain("<title>Plan</title>");
    expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-cache, must-revalidate");
  });

  it("serves the booking page at /reservar/<venue>, with the same headers", async () => {
    const response = await app.inject({ method: "GET", url: "/reservar/sample-bistro" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Book</title>");
    expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers["cache-control"]).toBe("no-cache, must-revalidate");
    // Only venue slugs: nothing else under /reservar comes from the folder.
    expect((await app.inject({ method: "GET", url: "/reservar/Not%20A%20Slug" })).statusCode).toBe(
      400,
    );
    expect((await app.inject({ method: "GET", url: "/reservar/a/b" })).statusCode).toBe(404);
  });

  it("caches hashed assets for a year", async () => {
    const response = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("answers files that are not there, and paths outside the folder, with 404", async () => {
    expect((await app.inject({ method: "GET", url: "/assets/missing.js" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/../package.json" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/%2e%2e/package.json" })).statusCode).toBe(404);
  });

  it("leaves the API routes alone", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toBeUndefined();
  });

  it("refuses a folder without a built app", async () => {
    const empty = mkdtempSync(join(tmpdir(), "floorplan-empty-"));
    try {
      await expect(buildApp({ pool, ...TEST_APP_OPTIONS, webDir: empty })).rejects.toThrow(
        /index\.html/,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
