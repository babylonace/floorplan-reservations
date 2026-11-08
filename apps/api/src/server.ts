import { buildApp } from "./app.js";
import { loadConfig, loadDotEnvIfPresent } from "./config.js";
import { createPool } from "./db.js";

loadDotEnvIfPresent();
const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = await buildApp({
  pool,
  logger: { level: config.logLevel },
  trustProxy: config.trustProxy,
  bookingRateLimit: config.bookingRateLimit,
});

app.addHook("onClose", async () => {
  await pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error, "Shutdown failed");
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: config.host, port: config.port });
