import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against the engine's source, so it does not have to be built first.
      "@floorplan-reservations/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "api",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // All API test files share one database, so they run one file at a time.
    fileParallelism: false,
  },
});
