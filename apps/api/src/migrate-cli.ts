import { loadConfig, loadDotEnvIfPresent } from "./config.js";
import { createPool } from "./db.js";
import { runMigrations } from "./migrate.js";

loadDotEnvIfPresent();
const pool = createPool(loadConfig().databaseUrl);

try {
  const applied = await runMigrations(pool);
  console.log(applied.length === 0 ? "Database is up to date." : `Applied: ${applied.join(", ")}`);
} finally {
  await pool.end();
}
