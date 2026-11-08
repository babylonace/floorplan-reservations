import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "./db.js";
import { floorPlanRoutes } from "./routes/floor-plan.js";
import { healthRoutes } from "./routes/health.js";

export interface AppOptions {
  pool: Pool;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp({ pool, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Floor plan reservations API",
        description: "Table reservations driven by the venue's own floor plan.",
        version: "0.1.0",
      },
    },
  });

  await app.register(healthRoutes, { pool });
  await app.register(floorPlanRoutes, { pool });

  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());

  return app;
}
