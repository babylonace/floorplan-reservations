import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// In development the API runs on its own port. Vite passes these paths on to it, so the browser
// only ever talks to one address and the session cookie stays same-origin, as in production.
const api = process.env.API_URL ?? "http://127.0.0.1:3000";

/**
 * Two pages: the staff editor (index.html) and the public booking page (reservar/index.html).
 * The API answers /reservar/<venue> with the booking page; this does the same in development.
 */
const bookingPage: Plugin = {
  name: "booking-page",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url && /^\/reservar\/[a-z0-9-]+\/?(\?.*)?$/.test(request.url)) {
        request.url = "/reservar/index.html";
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), bookingPage],
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
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        editor: fileURLToPath(new URL("index.html", import.meta.url)),
        booking: fileURLToPath(new URL("reservar/index.html", import.meta.url)),
      },
    },
  },
});
