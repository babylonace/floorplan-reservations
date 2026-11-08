import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: string;
  trustProxy: boolean | string;
  bookingRateLimit: { max: number; windowMs: number };
}

const ROOT_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

/**
 * Loads `.env` from the repository root when there is one. Variables already set in the
 * environment win, so containers and CI are never overridden by a stray file.
 */
export function loadDotEnvIfPresent(path: string = ROOT_ENV_FILE): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env or export it.");
  }

  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number between 1 and 65535, got "${env.PORT ?? ""}"`);
  }

  return {
    databaseUrl,
    host: env.HOST ?? "127.0.0.1",
    port,
    logLevel: env.LOG_LEVEL ?? "info",
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    bookingRateLimit: {
      max: positiveWhole(env, "BOOKING_RATE_LIMIT_MAX", 10),
      windowMs: positiveWhole(env, "BOOKING_RATE_LIMIT_WINDOW_MINUTES", 15) * 60_000,
    },
  };
}

function positiveWhole(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a whole number above 0, got "${raw}"`);
  }
  return value;
}

/**
 * TRUST_PROXY says which proxy in front of the API to believe about the guest's address:
 * unset or "false" for none, "true" for any, or a comma-separated list of the proxies'
 * addresses and ranges, such as "127.0.0.1,10.0.0.0/8". A list is safer than "true": with
 * "true", anyone can pick their own address by sending a made-up X-Forwarded-For header.
 */
export function parseTrustProxy(raw: string | undefined): boolean | string {
  if (raw === undefined || raw.trim() === "" || raw === "false") return false;
  if (raw === "true") return true;
  return raw;
}
