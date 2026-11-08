import type { Pool } from "../db.js";
import { hashPassword, passwordProblem } from "./passwords.js";

/** Staff accounts and the venues they may run. The staff command line uses these. */

export const ROLES = ["owner", "staff"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/** The address trimmed and in lower case, as it is stored; null when it cannot be one. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export class StaffError extends Error {}

type Queryable = Pick<Pool, "query">;

export async function findUserId(db: Queryable, email: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>("select id from staff_users where email = $1", [
    email,
  ]);
  return rows[0]?.id ?? null;
}

/** The venue's id. Throws a StaffError when there is no such venue. */
export async function venueId(db: Queryable, slug: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("select id from venues where slug = $1", [slug]);
  const id = rows[0]?.id;
  if (!id) throw new StaffError(`There is no venue called "${slug}".`);
  return id;
}

/** Creates an account. Throws a StaffError when the address is taken or the password is weak. */
export async function createUser(db: Queryable, email: string, password: string): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw new StaffError(problem);
  const hash = await hashPassword(password);
  const { rows } = await db.query<{ id: string }>(
    `insert into staff_users (email, password_hash) values ($1, $2)
     on conflict (email) do nothing returning id`,
    [email, hash],
  );
  const id = rows[0]?.id;
  if (!id) throw new StaffError(`${email} already has an account.`);
  return id;
}

/** Gives the account this role at the venue, replacing any role it had there. */
export async function grantRole(
  db: Queryable,
  userId: string,
  venueSlug: string,
  role: Role,
): Promise<void> {
  await db.query(
    `insert into venue_staff (venue_id, user_id, role) values ($1, $2, $3)
     on conflict (venue_id, user_id) do update set role = excluded.role`,
    [await venueId(db, venueSlug), userId, role],
  );
}

/** Takes the account off the venue. Returns false when it was not on it. */
export async function removeRole(
  db: Queryable,
  userId: string,
  venueSlug: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    "delete from venue_staff where venue_id = $1 and user_id = $2",
    [await venueId(db, venueSlug), userId],
  );
  return (rowCount ?? 0) > 0;
}

/** Ends every session of the account. Returns how many were open. */
export async function endAllSessions(db: Queryable, userId: string): Promise<number> {
  const { rowCount } = await db.query("delete from staff_sessions where user_id = $1", [userId]);
  return rowCount ?? 0;
}

/**
 * Lifts the lock that failed sign-ins put on an address. Returns false when it had none.
 * Someone who knows a staff member's address can lock it on purpose; this undoes that.
 */
export async function clearLoginFailures(db: Queryable, email: string): Promise<boolean> {
  const { rowCount } = await db.query("delete from login_failures where email = $1", [email]);
  return (rowCount ?? 0) > 0;
}

/**
 * Sets a new password, ends every session, so an old one cannot be used any more, and lifts
 * any lock from failed sign-ins.
 */
export async function setPassword(pool: Pool, userId: string, password: string): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new StaffError(problem);
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("update staff_users set password_hash = $2 where id = $1", [userId, hash]);
    await endAllSessions(client, userId);
    await client.query(
      "delete from login_failures where email = (select email from staff_users where id = $1)",
      [userId],
    );
    await client.query("commit");
    client.release();
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    client.release(true);
    throw error;
  }
}

export async function listStaff(
  db: Queryable,
  venueSlug: string,
): Promise<{ email: string; role: Role }[]> {
  const { rows } = await db.query<{ email: string; role: Role }>(
    `select u.email, vs.role from venue_staff vs join staff_users u on u.id = vs.user_id
      where vs.venue_id = $1 order by vs.role, u.email`,
    [await venueId(db, venueSlug)],
  );
  return rows;
}
