import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs on its own port. Vite passes these paths on to it, so the browser
// only ever talks to one address and the session cookie stays same-origin, as in production.
const api = process.env.API_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The editor checks the plan with the same engine as the API, straight from its source.
      "@floorplan-reservations/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/auth": api, "/venues": api, "/health": api },
  },
  build: { target: "es2022" },
});
