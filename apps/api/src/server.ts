import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig, loadDotEnvIfPresent } from "./config.js";
import { createPool } from "./db.js";
import { smtpMailer } from "./email/mailer.js";

loadDotEnvIfPresent();
const config = loadConfig();
const pool = createPool(config.databaseUrl);

// Without WEB_DIR, the web app is served when it has been built next to the API (npm run build).
const BUILT_WEB_DIR = fileURLToPath(new URL("../../web/dist", import.meta.url));
const webDir =
  config.webDir ?? (existsSync(`${BUILT_WEB_DIR}/index.html`) ? BUILT_WEB_DIR : undefined);

const app = await buildApp({
  pool,
  logger: { level: config.logLevel },
  trustProxy: config.trustProxy,
  bookingRateLimit: config.bookingRateLimit,
  loginRateLimit: config.loginRateLimit,
  webDir,
  mailer: config.smtp ? smtpMailer(config.smtp) : undefined,
});

app.log.info(
  config.smtp
    ? `E-mails go out through ${config.smtp.host}:${String(config.smtp.port)}`
    : "No SMTP_HOST: e-mails are written to the log instead of being sent",
);

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
