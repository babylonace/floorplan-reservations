import { loadConfig, loadDotEnvIfPresent } from "./config.js";
import { createPool } from "./db.js";
import { runSeed } from "./seed.js";

loadDotEnvIfPresent();
const pool = createPool(loadConfig().databaseUrl);

try {
  await runSeed(pool);
  console.log("Sample venue loaded.");
} finally {
  await pool.end();
}
