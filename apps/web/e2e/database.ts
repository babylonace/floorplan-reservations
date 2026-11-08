import { loadDotEnvIfPresent } from "../../api/src/config.js";

/**
 * The browser tests run the real API against their own database, which they wipe first. Its
 * name has to end in `_e2e`, so a mistyped URL can never destroy real data.
 */
export function e2eDatabaseUrl(): string {
  loadDotEnvIfPresent();
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E_DATABASE_URL is not set. Point it at an empty PostgreSQL database whose name ends in _e2e.",
    );
  }
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!name.endsWith("_e2e")) {
    throw new Error(
      `Refusing to use "${name}" for browser tests: they wipe it, so its name must end in _e2e.`,
    );
  }
  return url;
}

/** Made-up accounts that only exist in the browser tests' own database. */
export const OWNER = { email: "owner@example.com", password: "e2e-only-password-1234" };
export const STAFF = { email: "waiter@example.com", password: "e2e-only-password-5678" };

/** The made-up venue from db/seed/sample.sql. */
export const VENUE = { slug: "sample-bistro", name: "Sample Bistro" };
/** Table "4" in the dining room gets an upcoming booking, so it cannot be removed. */
export const BOOKED_TABLE_ID = "00000000-0000-4000-8000-000000001004";
