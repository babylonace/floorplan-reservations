import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "./db.js";
import { authRoutes, sessionSecurityScheme, type RateLimit } from "./routes/auth.js";
import { bookingRulesRoutes } from "./routes/booking-rules.js";
import { floorPlanRoutes } from "./routes/floor-plan.js";
import { healthRoutes } from "./routes/health.js";
import { planEditorRoutes } from "./routes/plan-editor.js";
import { reservationRoutes, type BookingRateLimit } from "./routes/reservations.js";
import { BusyError } from "./transaction.js";

export const DEFAULT_BOOKING_RATE_LIMIT: BookingRateLimit = { max: 10, windowMs: 15 * 60_000 };
export const DEFAULT_LOGIN_RATE_LIMIT: RateLimit = { max: 30, windowMs: 15 * 60_000 };

export interface AppOptions {
  pool: Pool;
  logger?: FastifyServerOptions["logger"];
  /**
   * Which proxies to believe about the caller's address. Behind a reverse proxy, leaving this
   * off makes every guest share the proxy's address, and so one rate limit.
   */
  trustProxy?: FastifyServerOptions["trustProxy"];
  bookingRateLimit?: BookingRateLimit;
  /** Sign-in requests one address may send per window, on top of the limit per e-mail address. */
  loginRateLimit?: RateLimit;
  /** Sign-ins checking a password at the same time; more get 503. */
  maxConcurrentLogins?: number;
  /** The current time. Tests set it; everyone else gets the clock. */
  now?: () => Date;
}

export async function buildApp({
  pool,
  logger = false,
  trustProxy = false,
  bookingRateLimit = DEFAULT_BOOKING_RATE_LIMIT,
  loginRateLimit = DEFAULT_LOGIN_RATE_LIMIT,
  maxConcurrentLogins,
  now = () => new Date(),
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy });

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
      components: { securitySchemes: sessionSecurityScheme },
    },
  });

  // Only routes that ask for it are limited (see the booking route). Counts live in this
  // process's memory: with several copies of the API, each one counts on its own.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error(`Too many requests. Please try again in ${context.after}.`), {
        statusCode: context.statusCode,
      }),
  });

  await app.register(healthRoutes, { pool });
  await app.register(floorPlanRoutes, { pool });
  await app.register(authRoutes, {
    pool,
    now,
    rateLimit: loginRateLimit,
    ...(maxConcurrentLogins === undefined ? {} : { maxConcurrentLogins }),
  });
  await app.register(planEditorRoutes, { pool, now });
  await app.register(bookingRulesRoutes, { pool, now });
  await app.register(reservationRoutes, { pool, now, rateLimit: bookingRateLimit });

  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());

  return app;
}
