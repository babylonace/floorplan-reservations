import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "../db.js";

const healthResponse = {
  type: "object",
  required: ["status", "database"],
  properties: {
    status: { type: "string", enum: ["ok", "error"] },
    database: { type: "string", enum: ["ok", "unreachable"] },
  },
} as const;

export const healthRoutes: FastifyPluginAsync<{ pool: Pool }> = (app, { pool }) => {
  app.get(
    "/health",
    {
      schema: {
        summary: "Is the API up and can it reach the database?",
        tags: ["system"],
        response: { 200: healthResponse, 503: healthResponse },
      },
    },
    async (request, reply) => {
      try {
        await pool.query("select 1");
        return { status: "ok", database: "ok" };
      } catch (error) {
        request.log.error(error, "Database health check failed");
        return reply.code(503).send({ status: "error", database: "unreachable" });
      }
    },
  );
  return Promise.resolve();
};
