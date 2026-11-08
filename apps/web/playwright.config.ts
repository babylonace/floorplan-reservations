import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./e2e/database.js";

// The API serves the built web app, as it does in production: one address, real cookies.
const PORT = 4318;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  // The tests share one database and change it, so they run one at a time, in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    locale: "es-ES",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node ../api/dist/server.js",
    url: `http://127.0.0.1:${String(PORT)}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      HOST: "127.0.0.1",
      PORT: String(PORT),
      WEB_DIR: "dist",
      LOG_LEVEL: "warn",
    },
  },
});
