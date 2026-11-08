import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { makeDummyHash, verifyPassword } from "../auth/passwords.js";
import {
  clearedSessionCookie,
  createSession,
  deleteExpiredSessions,
  endSession,
  findSession,
  readSessionCookie,
  SESSION_COOKIE,
  sessionCookie,
} from "../auth/sessions.js";
import { normalizeEmail, ROLES, type Role } from "../auth/staff.js";
import type { Pool } from "../db.js";
import { errorResponse, SLUG_PATTERN } from "./shared.js";

/**
 * Staff sign in with their e-mail address and password, and get a session cookie. Routes that
 * change a venue ask `requireVenueRole` for a session with the right role at that venue.
 */

export interface RateLimit {
  /** Requests one address may send per window. */
  max: number;
  windowMs: number;
}

/** Failed sign-ins one e-mail address may have per window, from any number of places. */
export const MAX_LOGIN_FAILURES = 10;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
/**
 * Sign-ins checking a password at once, from everyone together. Each check needs 32 MiB and a
 * slot in Node's small pool of worker threads, so a flood of them would slow everything else.
 */
export const DEFAULT_MAX_CONCURRENT_LOGINS = 16;

const SLUG = new RegExp(SLUG_PATTERN);

const WRONG_LOGIN = "Wrong e-mail address or password.";
const LOCKED_OUT = "Too many failed sign-ins for this address. Please try again in 15 minutes.";

/** OpenAPI name of the session cookie, for the routes that need it. */
export const SESSION_SECURITY = [{ staffSession: [] }];

export const authResponses = { 401: errorResponse, 403: errorResponse } as const;

type Queryable = Pick<Pool, "query">;

/**
 * True when a browser says another site started this request. SameSite=Strict already keeps
 * the cookie off such requests; this also turns away other subdomains of the same site.
 * Programs that are not browsers do not send the header and are let through.
 */
function fromAnotherSite(request: FastifyRequest): boolean {
  const site = request.headers["sec-fetch-site"];
  return site === "cross-site" || site === "same-site";
}

function refuseOtherSites(reply: FastifyReply) {
  return reply.code(403).send({ error: "Requests from other sites are not allowed." });
}

/**
 * A hook for routes under /venues/:slug that only signed-in staff with one of `roles` at that
 * venue may use. Answers 401 without a valid session and 403 without the role.
 */
export function requireVenueRole(
  pool: Pool,
  now: () => Date,
  roles: readonly Role[],
): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
  return async (request, reply) => {
    if (fromAnotherSite(request)) return refuseOtherSites(reply);
    const token = readSessionCookie(request.headers.cookie);
    const { slug } = request.params as { slug?: string };
    // Hooks run before the address is checked; a slug no venue can have names no venue.
    const venue = slug !== undefined && SLUG.test(slug) ? slug : null;
    const user = token ? await findSession(pool, token, now(), venue) : null;
    if (!user) return reply.code(401).send({ error: "Please sign in first." });
    if (!user.role || !roles.includes(user.role)) {
      return reply.code(403).send({ error: "Your account may not do this at this venue." });
    }
  };
}

/**
 * Counts one more sign-in attempt for the address and says whether it is still allowed. The
 * attempt is counted before the password is checked, so attempts sent all at once cannot slip
 * past the limit; a successful sign-in clears the count.
 */
async function countAttempt(db: Queryable, email: string, now: Date): Promise<boolean> {
  await db.query(
    "delete from login_failures where window_start <= $1::timestamptz - make_interval(secs => $2)",
    [now, LOGIN_FAILURE_WINDOW_SECONDS],
  );
  const { rows } = await db.query<{ failures: number }>(
    `insert into login_failures as f (email, failures, window_start) values ($1, 1, $2)
     on conflict (email) do update set failures = f.failures + 1
     returning failures`,
    [email, now],
  );
  return (rows[0]?.failures ?? 1) <= MAX_LOGIN_FAILURES;
}

const venuesSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["slug", "name", "role"],
    properties: {
      slug: { type: "string" },
      name: { type: "string" },
      role: { type: "string", enum: [...ROLES] },
    },
  },
} as const;

const accountSchema = {
  type: "object",
  required: ["email", "venues"],
  properties: { email: { type: "string" }, venues: venuesSchema },
} as const;

async function account(db: Queryable, userId: string, email: string) {
  const { rows } = await db.query<{ slug: string; name: string; role: Role }>(
    `select v.slug, v.name, vs.role from venue_staff vs join venues v on v.id = vs.venue_id
      where vs.user_id = $1 order by v.name, v.slug`,
    [userId],
  );
  return { email, venues: rows };
}

export interface AuthRouteOptions {
  pool: Pool;
  now: () => Date;
  rateLimit: RateLimit;
  maxConcurrentLogins?: number;
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  { pool, now, rateLimit, maxConcurrentLogins = DEFAULT_MAX_CONCURRENT_LOGINS },
) => {
  const tags = ["staff sign-in"];
  const dummyHash = await makeDummyHash();
  let checking = 0;

  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    {
      config: { rateLimit: { max: rateLimit.max, timeWindow: rateLimit.windowMs } },
      schema: {
        summary: "Sign in as staff. Sets the session cookie.",
        description:
          `The answer is the same whether or not the address has an account. After ` +
          `${String(MAX_LOGIN_FAILURES)} failed attempts for one address in 15 minutes, that ` +
          `address is refused with 429 until the 15 minutes are over.`,
        tags,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "password"],
          properties: {
            email: { type: "string", minLength: 1, maxLength: 254 },
            password: { type: "string", minLength: 1, maxLength: 1000 },
          },
        },
        response: {
          200: accountSchema,
          401: errorResponse,
          403: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    },
    async (request, reply) => {
      if (fromAnotherSite(request)) return refuseOtherSites(reply);
      const at = now();
      const email = request.body.email.trim().toLowerCase();

      if (!(await countAttempt(pool, email, at))) {
        return reply.code(429).send({ error: LOCKED_OUT });
      }

      const valid = normalizeEmail(email);
      const { rows } = valid
        ? await pool.query<{ id: string; password_hash: string }>(
            "select id, password_hash from staff_users where email = $1",
            [valid],
          )
        : { rows: [] };
      const user = rows[0];
      if (checking >= maxConcurrentLogins) {
        return reply
          .code(503)
          .header("retry-after", "5")
          .send({ error: "Too busy right now. Please try again in a few seconds." });
      }
      // The attempt above still counts: a busy server gives no free guesses.
      checking += 1;
      let matches: boolean;
      try {
        // Unknown addresses are checked against a hash too, so they take just as long.
        matches = await verifyPassword(request.body.password, user?.password_hash ?? dummyHash);
      } finally {
        checking -= 1;
      }
      if (!user || !matches) return reply.code(401).send({ error: WRONG_LOGIN });

      await pool.query("delete from login_failures where email = $1", [email]);
      await deleteExpiredSessions(pool, at);
      // Signing in again replaces the session this browser had.
      const previous = readSessionCookie(request.headers.cookie);
      if (previous) await endSession(pool, previous);
      const token = await createSession(pool, user.id, at);

      reply.header("set-cookie", sessionCookie(token));
      reply.header("cache-control", "no-store");
      return account(pool, user.id, email);
    },
  );

  app.post(
    "/auth/logout",
    {
      schema: {
        summary: "Sign out: ends this session and clears the cookie.",
        tags,
        response: { 204: { type: "null" }, 403: errorResponse },
      },
    },
    async (request, reply) => {
      if (fromAnotherSite(request)) return refuseOtherSites(reply);
      const token = readSessionCookie(request.headers.cookie);
      if (token) await endSession(pool, token);
      return reply.header("set-cookie", clearedSessionCookie()).code(204).send();
    },
  );

  app.get(
    "/auth/me",
    {
      schema: {
        summary: "The signed-in account and the venues it may run.",
        tags,
        security: SESSION_SECURITY,
        response: { 200: accountSchema, 401: errorResponse },
      },
    },
    async (request, reply) => {
      const token = readSessionCookie(request.headers.cookie);
      const user = token ? await findSession(pool, token, now()) : null;
      if (!user) return reply.code(401).send({ error: "Please sign in first." });
      reply.header("cache-control", "no-store");
      return account(pool, user.id, user.email);
    },
  );
};

/** The OpenAPI description of the session cookie. */
export const sessionSecurityScheme = {
  staffSession: { type: "apiKey", in: "cookie", name: SESSION_COOKIE },
} as const;
