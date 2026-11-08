import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "../db.js";
import type { Role } from "./staff.js";

/**
 * Staff sessions live in PostgreSQL. The browser holds a random token in a cookie that page
 * scripts cannot read; the database keeps only its SHA-256, so a copy of the table cannot be
 * used to sign in. A session ends after IDLE_SECONDS without use, and in any case
 * MAX_AGE_SECONDS after sign-in.
 */

export const SESSION_COOKIE = "__Host-floorplan_session";
export const IDLE_SECONDS = 12 * 60 * 60;
export const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Queryable = Pick<Pool, "query">;

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** Opens a session and returns the token for the cookie. */
export async function createSession(db: Queryable, userId: string, now: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `insert into staff_sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
     values ($1, $2, $3, $3, $3::timestamptz + make_interval(secs => $4))`,
    [hashToken(token), userId, now, IDLE_SECONDS],
  );
  return token;
}

export interface SessionUser {
  id: string;
  email: string;
  /** The account's role at the venue that was asked about, if any. */
  role: Role | null;
}

/**
 * The account behind a session token, or null when the token is unknown or has run out. Using
 * a session moves its idle limit forward. With `venueSlug`, also reads the role there.
 */
export async function findSession(
  db: Queryable,
  token: string,
  now: Date,
  venueSlug: string | null = null,
): Promise<SessionUser | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const { rows } = await db.query<SessionUser>(
    `with session as (
       update staff_sessions
          set last_seen_at = $2,
              expires_at = least($2::timestamptz + make_interval(secs => $3),
                                 created_at + make_interval(secs => $4))
        where token_hash = $1 and expires_at > $2
       returning user_id
     )
     select u.id, u.email,
            (select vs.role from venue_staff vs join venues v on v.id = vs.venue_id
              where vs.user_id = u.id and v.slug = $5) as role
       from session join staff_users u on u.id = session.user_id`,
    [hashToken(token), now, IDLE_SECONDS, MAX_AGE_SECONDS, venueSlug],
  );
  return rows[0] ?? null;
}

/** Ends one session. Unknown tokens are ignored. */
export async function endSession(db: Queryable, token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) return;
  await db.query("delete from staff_sessions where token_hash = $1", [hashToken(token)]);
}

/** Clears out sessions that ran out, so the table does not grow for ever. */
export async function deleteExpiredSessions(db: Queryable, now: Date): Promise<void> {
  await db.query("delete from staff_sessions where expires_at <= $1", [now]);
}

/** The session token from a Cookie header, if there is one. */
export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

/**
 * The cookie that carries the session: only sent over HTTPS (browsers also allow it on
 * http://localhost), never readable by page scripts, and never sent along with requests that
 * other sites start. The __Host- prefix makes browsers refuse it unless it is set that way.
 */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${String(MAX_AGE_SECONDS)}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
