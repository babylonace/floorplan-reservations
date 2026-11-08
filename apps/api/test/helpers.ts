import { loadDotEnvIfPresent } from "../src/config.js";

/**
 * The database the tests use. The tests wipe it, so the name has to end in `_test`:
 * that keeps a mistyped URL from destroying real data.
 */
export function testDatabaseUrl(): string {
  loadDotEnvIfPresent();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at an empty PostgreSQL database whose name ends in _test.",
    );
  }

  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run the tests against "${name}": they wipe the database, so its name must end in _test.`,
    );
  }
  return url;
}

export const SAMPLE_VENUE_ID = "00000000-0000-4000-8000-000000000001";
export const SAMPLE_ZONE_ID = "00000000-0000-4000-8000-000000000101";
export const SAMPLE_TABLE_ID = "00000000-0000-4000-8000-000000001001";
