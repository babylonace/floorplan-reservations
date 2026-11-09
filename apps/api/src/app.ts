import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "./db.js";
import { logMailer, type Mailer } from "./email/mailer.js";
import { startEmailWorker } from "./email/outbox.js";
import { authRoutes, sessionSecurityScheme, type RateLimit } from "./routes/auth.js";
import { bookingRulesRoutes } from "./routes/booking-rules.js";
import { floorPlanRoutes } from "./routes/floor-plan.js";
import { guestBookingRoutes, type AvailabilityRateLimit } from "./routes/guest-booking.js";
import { healthRoutes } from "./routes/health.js";
import { planEditorRoutes } from "./routes/plan-editor.js";
import { reservationRoutes, type BookingRateLimit } from "./routes/reservations.js";
import { serviceRoutes } from "./routes/service.js";
import { webRoutes } from "./routes/web.js";
import { BusyError } from "./transaction.js";

export const DEFAULT_BOOKING_RATE_LIMIT: BookingRateLimit = { max: 10, windowMs: 15 * 60_000 };
/** Each change on the booking page (day, party size) asks once, so this leaves plenty of room. */
export const DEFAULT_AVAILABILITY_RATE_LIMIT: AvailabilityRateLimit = {
  max: 120,
  windowMs: 15 * 60_000,
};
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
  availabilityRateLimit?: AvailabilityRateLimit;
  /** Sign-in requests one address may send per window, on top of the limit per e-mail address. */
  loginRateLimit?: RateLimit;
  /** Sign-ins checking a password at the same time; more get 503. */
  maxConcurrentLogins?: number;
  /** The current time. Tests set it; everyone else gets the clock. */
  now?: () => Date;
  /** A folder with the built staff web app, served at /. Without it, only the API answers. */
  webDir?: string | undefined;
  /** Sends the e-mails. Without it they are only written to the log. */
  mailer?: Mailer | undefined;
  /**
   * "auto" sends queued e-mails right after each change and checks for retries every
   * `emailIntervalMs`. "manual" leaves them in the queue, for tests that send them themselves.
   */
  emailDelivery?: "auto" | "manual";
  emailIntervalMs?: number;
}

/** Keeps the values of a database row out of the log: PostgreSQL puts them in `detail`. */
function withoutRowValues(error: unknown): unknown {
  if (!(error instanceof Error) || !("detail" in error)) return error;
  const copy = new Error(error.message);
  copy.name = error.name;
  if (error.stack !== undefined) copy.stack = error.stack;
  const { code, constraint, table } = error as {
    code?: unknown;
    constraint?: unknown;
    table?: unknown;
  };
  return Object.assign(copy, { code, constraint, table });
}

export async function buildApp({
  pool,
  logger = false,
  trustProxy = false,
  bookingRateLimit = DEFAULT_BOOKING_RATE_LIMIT,
  availabilityRateLimit = DEFAULT_AVAILABILITY_RATE_LIMIT,
  loginRateLimit = DEFAULT_LOGIN_RATE_LIMIT,
  maxConcurrentLogins,
  now = () => new Date(),
  webDir,
  mailer,
  emailDelivery = "auto",
  emailIntervalMs = 30_000,
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
      request.log.error(withoutRowValues(error), "Request failed");
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

  const emails =
    emailDelivery === "auto"
      ? startEmailWorker({
          pool,
          mailer: mailer ?? logMailer(app.log),
          now,
          log: app.log,
          intervalMs: emailIntervalMs,
        })
      : null;
  // Waits for e-mails being sent, so closing never cuts one off halfway.
  app.addHook("onClose", async () => {
    await emails?.stop();
  });
  const onEmailsQueued = () => {
    emails?.kick();
  };

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
  await app.register(reservationRoutes, {
    pool,
    now,
    rateLimit: bookingRateLimit,
    onEmailsQueued,
  });
  await app.register(serviceRoutes, { pool, now, onEmailsQueued });
  await app.register(guestBookingRoutes, { pool, now, rateLimit: availabilityRateLimit });

  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());

  if (webDir !== undefined) await app.register(webRoutes, { dir: webDir });

  return app;
}
