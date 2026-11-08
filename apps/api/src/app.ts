import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "./db.js";
import { floorPlanRoutes } from "./routes/floor-plan.js";
import { healthRoutes } from "./routes/health.js";
import { planEditorRoutes } from "./routes/plan-editor.js";
import { reservationRoutes } from "./routes/reservations.js";
import { BusyError } from "./transaction.js";

export interface AppOptions {
  pool: Pool;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp({ pool, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  // Server errors are logged in full but answered with a generic message, so database
  // details (hosts, table names) never reach the caller.
  app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
    if (error instanceof BusyError) {
      return reply
        .code(503)
        .header("retry-after", "5")
        .send({ error: "Too busy right now. Please try again in a few seconds." });
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error(error, "Request failed");
      return reply.code(500).send({ error: "Internal error" });
    }
    return reply.code(statusCode).send({ error: error.message });
  });

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
  await app.register(planEditorRoutes, { pool });
  await app.register(reservationRoutes, { pool });

  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());

  return app;
}
