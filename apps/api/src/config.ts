import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: string;
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
  };
}
