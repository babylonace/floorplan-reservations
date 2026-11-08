import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword, passwordProblem, verifyPassword } from "../src/auth/passwords.js";
import { IDLE_SECONDS, MAX_AGE_SECONDS, SESSION_COOKIE } from "../src/auth/sessions.js";
import {
  clearLoginFailures,
  createUser,
  grantRole,
  removeRole,
  setPassword,
  type Role,
} from "../src/auth/staff.js";
import { createPool } from "../src/db.js";
import { MAX_LOGIN_FAILURES } from "../src/routes/auth.js";
import {
  createVenue,
  deleteVenue,
  newGuestEmail,
  signIn,
  TEST_APP_OPTIONS,
  TEST_NOW,
  TEST_PASSWORD,
  testDatabaseUrl,
} from "./helpers.js";

const pool = createPool(testDatabaseUrl());
let clock = TEST_NOW;
let app: FastifyInstance;
const slugs: string[] = [];
let accounts = 0;

beforeAll(async () => {
  app = await buildApp({ pool, ...TEST_APP_OPTIONS, now: () => clock });
});

afterEach(async () => {
  clock = TEST_NOW;
  for (const slug of slugs.splice(0)) await deleteVenue(pool, slug);
  await pool.query("delete from staff_users where email like 'auth-%'");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

function later(seconds: number) {
  clock = new Date(clock.getTime() + seconds * 1000);
}

async function venue(slug: string) {
  slugs.push(slug);
  await createVenue(pool, slug, [{ label: "1", x: 100 }]);
}

/** A new account with the test password, with `role` at `slug` when given. */
async function account(
  slug?: string,
  role: Role = "owner",
): Promise<{ id: string; email: string }> {
  accounts += 1;
  const email = `auth-${String(accounts)}@example.com`;
  const id = await createUser(pool, email, TEST_PASSWORD);
  if (slug) await grantRole(pool, id, slug, role);
  return { id, email };
}

function login(email: string, password: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: "/auth/login", headers, payload: { email, password } });
}

function me(cookie?: string) {
  return app.inject({ method: "GET", url: "/auth/me", headers: cookie ? { cookie } : {} });
}

/** A change only an owner may make: adding a zone. */
function addZone(slug: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: `/venues/${slug}/zones`,
    headers,
    payload: { name: `Zone ${String(Math.random())}`, width: 500, height: 500 },
  });
}

function errorOf(response: LightMyRequestResponse): string {
  return response.json<{ error: string }>().error;
}

describe("passwords", () => {
  it("are stored as salted scrypt hashes that only the right password matches", async () => {
    const first = await hashPassword("a long enough password");
    const second = await hashPassword("a long enough password");
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("a long enough password");
    await expect(verifyPassword("a long enough password", first)).resolves.toBe(true);
    await expect(verifyPassword("a long enough passworD", first)).resolves.toBe(false);
    await expect(verifyPassword("", first)).resolves.toBe(false);
  });

  it("match whichever way an accented letter was typed", async () => {
    const composed = "contraseña de prueba";
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    await expect(verifyPassword(decomposed, await hashPassword(composed))).resolves.toBe(true);
  });

  it("never match a damaged or foreign hash", async () => {
    const good = await hashPassword("a long enough password");
    const parts = good.split("$");
    const damaged = [
      "",
      "plain text",
      "bcrypt$2b$10$abc",
      good.replace("scrypt$32768", "scrypt$1000"),
      good.replace("scrypt$32768", "scrypt$1073741824"),
      [...parts.slice(0, 5), "c2hvcnQ="].join("$"),
    ];
    for (const stored of damaged) {
      await expect(verifyPassword("a long enough password", stored)).resolves.toBe(false);
    }
  });

  it("must be 12 to 200 characters and not only spaces", () => {
    expect(passwordProblem("short")).toMatch(/at least 12/);
    expect(passwordProblem("eleven char")).toMatch(/at least 12/);
    expect(passwordProblem("twelve chars")).toBeNull();
    expect(passwordProblem("ñ".repeat(12))).toBeNull();
    expect(passwordProblem("x".repeat(201))).toMatch(/at most 200/);
    expect(passwordProblem(" ".repeat(20))).toMatch(/spaces/);
  });
});

describe("signing in and out", () => {
  it("sets a session cookie that scripts cannot read and other sites do not get", async () => {
    await venue("auth-cookie");
    const { email } = await account("auth-cookie");

    const response = await login(email, TEST_PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      email,
      venues: [{ slug: "auth-cookie", name: "auth-cookie", role: "owner" }],
    });

    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toMatchObject({
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: MAX_AGE_SECONDS,
    });
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.domain).toBeUndefined();
  });

  it("keeps only a hash of the session token in the database", async () => {
    const { id, email } = await account();
    const cookie = await signIn(app, email, TEST_PASSWORD);
    const token = cookie.split("=")[1] ?? "";

    const { rows } = await pool.query<{ token_hash: Buffer }>(
      "select token_hash from staff_sessions where user_id = $1",
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash.length).toBe(32);
    expect(rows[0]?.token_hash.toString("utf8")).not.toContain(token);
    expect(rows[0]?.token_hash.toString("base64url")).not.toBe(token);
  });

  it("accepts the address in any case and with spaces around it", async () => {
    const { email } = await account();
    const response = await login(`  ${email.toUpperCase()} `, TEST_PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ email: string }>().email).toBe(email);
  });

  it("gives the same answer for a wrong password and for an address with no account", async () => {
    const { email } = await account();
    const wrongPassword = await login(email, "not the right password");
    const noAccount = await login("auth-nobody@example.com", TEST_PASSWORD);
    const notAnAddress = await login("auth-not-an-address", TEST_PASSWORD);

    for (const response of [wrongPassword, noAccount, notAnAddress]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Wrong e-mail address or password." });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("tells who is signed in, and forgets them after signing out", async () => {
    await venue("auth-me");
    const { email } = await account("auth-me", "staff");
    const cookie = await signIn(app, email, TEST_PASSWORD);

    const before = await me(cookie);
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({
      email,
      venues: [{ slug: "auth-me", name: "auth-me", role: "staff" }],
    });

    const logout = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(204);
    const cleared = logout.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);

    // The old cookie is dead on the server, even if a browser kept it.
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("signs out quietly with no session or a made-up one", async () => {
    for (const headers of [{}, { cookie: `${SESSION_COOKIE}=${"b".repeat(43)}` }]) {
      const response = await app.inject({ method: "POST", url: "/auth/logout", headers });
      expect(response.statusCode).toBe(204);
    }
  });

  it("answers 401 to /auth/me without a session or with a made-up one", async () => {
    expect((await me()).statusCode).toBe(401);
    expect((await me(`${SESSION_COOKIE}=${"a".repeat(43)}`)).statusCode).toBe(401);
    expect((await me(`${SESSION_COOKIE}=not-even-the-right-shape`)).statusCode).toBe(401);
    expect((await me("other=1")).statusCode).toBe(401);
  });

  it("replaces this browser's old session when signing in again", async () => {
    const { id, email } = await account();
    const first = await signIn(app, email, TEST_PASSWORD);
    const second = await login(email, TEST_PASSWORD, { cookie: first });
    expect(second.statusCode).toBe(200);

    expect((await me(first)).statusCode).toBe(401);
    const { rows } = await pool.query("select 1 from staff_sessions where user_id = $1", [id]);
    expect(rows).toHaveLength(1);
  });

  it("refuses sign-ins that another site starts", async () => {
    const { email } = await account();
    for (const site of ["cross-site", "same-site"]) {
      const response = await login(email, TEST_PASSWORD, { "sec-fetch-site": site });
      expect(response.statusCode).toBe(403);
    }
    // Same origin, an address typed by hand, and programs that send no such header are fine.
    for (const site of ["same-origin", "none"]) {
      expect((await login(email, TEST_PASSWORD, { "sec-fetch-site": site })).statusCode).toBe(200);
    }
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(200);
  });
});

describe("session lifetime", () => {
  it(`ends a session after ${String(IDLE_SECONDS / 3600)} hours without use`, async () => {
    const { email } = await account();
    const cookie = await signIn(app, email, TEST_PASSWORD);

    later(IDLE_SECONDS - 60);
    expect((await me(cookie)).statusCode).toBe(200);
    // Using it moved the limit forward.
    later(IDLE_SECONDS - 60);
    expect((await me(cookie)).statusCode).toBe(200);
    later(IDLE_SECONDS + 1);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("ends a session 30 days after sign-in even if it is used all the time", async () => {
    const { email } = await account();
    const cookie = await signIn(app, email, TEST_PASSWORD);

    // Used every 11 hours, so it never sits idle long enough to end that way.
    const step = 11 * 60 * 60;
    let elapsed = 0;
    while (elapsed + step < MAX_AGE_SECONDS) {
      later(step);
      elapsed += step;
      expect((await me(cookie)).statusCode).toBe(200);
    }
    later(MAX_AGE_SECONDS - elapsed);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("clears out sessions that ran out when someone signs in", async () => {
    const { id, email } = await account();
    await signIn(app, email, TEST_PASSWORD);
    later(IDLE_SECONDS + 1);
    await signIn(app, email, TEST_PASSWORD);

    const { rows } = await pool.query("select 1 from staff_sessions where user_id = $1", [id]);
    expect(rows).toHaveLength(1);
  });

  it("signs the account out everywhere when its password changes", async () => {
    const { id, email } = await account();
    const laptop = await signIn(app, email, TEST_PASSWORD);
    const tablet = await signIn(app, email, TEST_PASSWORD);

    await setPassword(pool, id, "a brand new test password");
    expect((await me(laptop)).statusCode).toBe(401);
    expect((await me(tablet)).statusCode).toBe(401);
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(401);
    expect((await login(email, "a brand new test password")).statusCode).toBe(200);
  });
});

describe("limits on sign-in attempts", () => {
  it(`locks an address for 15 minutes after ${String(MAX_LOGIN_FAILURES)} failures`, async () => {
    const { email } = await account();
    for (let attempt = 0; attempt < MAX_LOGIN_FAILURES; attempt += 1) {
      expect((await login(email, "a wrong guess here")).statusCode).toBe(401);
    }
    // Even the right password waits now.
    const locked = await login(email, TEST_PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(errorOf(locked)).toMatch(/15 minutes/);

    later(15 * 60 + 1);
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(200);
  });

  it("locks an address with no account the same way, so the lock gives nothing away", async () => {
    const email = "auth-ghost@example.com";
    for (let attempt = 0; attempt < MAX_LOGIN_FAILURES; attempt += 1) {
      expect((await login(email, "a wrong guess here")).statusCode).toBe(401);
    }
    expect((await login(email, "a wrong guess here")).statusCode).toBe(429);
  });

  it("lifts the lock when staff unlock the address or set a new password", async () => {
    const { id, email } = await account();
    for (let attempt = 0; attempt <= MAX_LOGIN_FAILURES; attempt += 1) {
      await login(email, "a wrong guess here");
    }
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(429);
    expect(await clearLoginFailures(pool, email)).toBe(true);
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(200);

    for (let attempt = 0; attempt <= MAX_LOGIN_FAILURES; attempt += 1) {
      await login(email, "a wrong guess here");
    }
    await setPassword(pool, id, "a brand new test password");
    expect((await login(email, "a brand new test password")).statusCode).toBe(200);
  });

  it("answers 503 when too many passwords are being checked at once", async () => {
    const busy = await buildApp({ pool, ...TEST_APP_OPTIONS, maxConcurrentLogins: 1 });
    try {
      const { email } = await account();
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          busy.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email, password: TEST_PASSWORD },
          }),
        ),
      );
      const codes = responses.map((response) => response.statusCode).sort();
      expect(codes[0]).toBe(200);
      expect(codes).toContain(503);
      const refused = responses.find((response) => response.statusCode === 503);
      expect(refused?.headers["retry-after"]).toBe("5");
    } finally {
      await busy.close();
    }
  });

  it("starts counting again after a successful sign-in", async () => {
    const { email } = await account();
    for (let attempt = 0; attempt < MAX_LOGIN_FAILURES - 1; attempt += 1) {
      await login(email, "a wrong guess here");
    }
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(200);
    for (let attempt = 0; attempt < MAX_LOGIN_FAILURES - 1; attempt += 1) {
      expect((await login(email, "a wrong guess here")).statusCode).toBe(401);
    }
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(200);
  });

  it("does not let guesses sent all at once slip past the limit", async () => {
    const { email } = await account();
    const responses = await Promise.all(
      Array.from({ length: 25 }, () => login(email, "a wrong guess here")),
    );
    const codes = responses.map((response) => response.statusCode);
    expect(codes.filter((code) => code === 401)).toHaveLength(MAX_LOGIN_FAILURES);
    expect(codes.filter((code) => code === 429)).toHaveLength(25 - MAX_LOGIN_FAILURES);
  });

  it("also limits how many sign-ins one network address may send", async () => {
    const limited = await buildApp({
      pool,
      ...TEST_APP_OPTIONS,
      loginRateLimit: { max: 3, windowMs: 60_000 },
    });
    try {
      const codes: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await limited.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: `auth-ip-${String(attempt)}@example.com`, password: "whatever it is" },
        });
        codes.push(response.statusCode);
      }
      expect(codes).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("who may change a venue", () => {
  it("needs a signed-in owner of that venue to edit its plan or its booking rules", async () => {
    await venue("auth-guarded");
    const { email } = await account("auth-guarded", "owner");
    const cookie = await signIn(app, email, TEST_PASSWORD);

    const anonymous = await addZone("auth-guarded");
    expect(anonymous.statusCode).toBe(401);
    expect(errorOf(anonymous)).toMatch(/sign in/);
    expect((await addZone("auth-guarded", { cookie })).statusCode).toBe(201);

    const rules = { horizonDays: 30, weekly: [], specialDays: [] };
    const put = (headers: Record<string, string>) =>
      app.inject({
        method: "PUT",
        url: "/venues/auth-guarded/booking-rules",
        headers,
        payload: rules,
      });
    expect((await put({})).statusCode).toBe(401);
    expect((await put({ cookie })).statusCode).toBe(204);
  });

  it("guards every route that edits the plan, before reading the request body", async () => {
    await venue("auth-every-route");
    const zone = "00000000-0000-4000-8000-000000000000";
    const routes: [string, string][] = [
      ["POST", "/venues/auth-every-route/zones"],
      ["PATCH", `/venues/auth-every-route/zones/${zone}`],
      ["DELETE", `/venues/auth-every-route/zones/${zone}`],
      ["POST", `/venues/auth-every-route/zones/${zone}/tables`],
      ["PATCH", `/venues/auth-every-route/tables/${zone}`],
      ["DELETE", `/venues/auth-every-route/tables/${zone}`],
      ["PUT", "/venues/auth-every-route/booking-rules"],
    ];
    for (const [method, url] of routes) {
      const response = await app.inject({
        method: method as "POST",
        url,
        payload: { not: "valid" },
      });
      expect({ method, url, status: response.statusCode }).toEqual({ method, url, status: 401 });
    }
  });

  it("refuses staff without the owner role, and owners of other venues", async () => {
    await venue("auth-mine");
    await venue("auth-theirs");
    const staff = await account("auth-mine", "staff");
    const otherOwner = await account("auth-theirs", "owner");
    const nobody = await account();

    for (const { email } of [staff, otherOwner, nobody]) {
      const cookie = await signIn(app, email, TEST_PASSWORD);
      const response = await addZone("auth-mine", { cookie });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response)).toMatch(/may not/);
    }
    // A venue that does not exist is refused the same way, not with 404.
    const cookie = await signIn(app, otherOwner.email, TEST_PASSWORD);
    expect((await addZone("auth-nowhere", { cookie })).statusCode).toBe(403);
  });

  it("cannot reach another venue's table through its own venue's address", async () => {
    await venue("auth-a");
    await venue("auth-b");
    const owner = await account("auth-a", "owner");
    const cookie = await signIn(app, owner.email, TEST_PASSWORD);
    const { rows } = await pool.query<{ id: string }>(
      "select t.id from dining_tables t join venues v on v.id = t.venue_id where v.slug = 'auth-b'",
    );
    const response = await app.inject({
      method: "PATCH",
      url: `/venues/auth-a/tables/${rows[0]?.id ?? ""}`,
      headers: { cookie },
      payload: { label: "taken" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("refuses an address with characters no venue can have, without a server error", async () => {
    await venue("auth-odd");
    const owner = await account("auth-odd", "owner");
    const cookie = await signIn(app, owner.email, TEST_PASSWORD);
    for (const slug of ["%00", "AUTH-ODD", "auth-odd%00", "auth_odd"]) {
      const response = await addZone(slug, { cookie });
      expect({ slug, status: response.statusCode }).toEqual({ slug, status: 403 });
    }
  });

  it("takes effect at once when an owner becomes plain staff", async () => {
    await venue("auth-demoted");
    const owner = await account("auth-demoted", "owner");
    const cookie = await signIn(app, owner.email, TEST_PASSWORD);
    expect((await addZone("auth-demoted", { cookie })).statusCode).toBe(201);

    await grantRole(pool, owner.id, "auth-demoted", "staff");
    expect((await addZone("auth-demoted", { cookie })).statusCode).toBe(403);
  });

  it("takes effect at once when an owner is taken off a venue", async () => {
    await venue("auth-removed");
    const owner = await account("auth-removed", "owner");
    const cookie = await signIn(app, owner.email, TEST_PASSWORD);
    expect((await addZone("auth-removed", { cookie })).statusCode).toBe(201);

    await removeRole(pool, owner.id, "auth-removed");
    expect((await addZone("auth-removed", { cookie })).statusCode).toBe(403);
  });

  it("refuses edits that another site starts, even with the owner's cookie", async () => {
    await venue("auth-csrf");
    const owner = await account("auth-csrf", "owner");
    const cookie = await signIn(app, owner.email, TEST_PASSWORD);
    const response = await addZone("auth-csrf", { cookie, "sec-fetch-site": "cross-site" });
    expect(response.statusCode).toBe(403);
    expect(
      (await addZone("auth-csrf", { cookie, "sec-fetch-site": "same-origin" })).statusCode,
    ).toBe(201);
  });

  it("leaves guests free to read the plan and the rules, and to book", async () => {
    await venue("auth-public");
    expect(
      (await app.inject({ method: "GET", url: "/venues/auth-public/floor-plan" })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/venues/auth-public/booking-rules" })).statusCode,
    ).toBe(200);
    const booking = await app.inject({
      method: "POST",
      url: "/venues/auth-public/reservations",
      payload: {
        guestName: "Test Guest",
        guestEmail: newGuestEmail(),
        partySize: 2,
        startsAt: "2030-05-25T20:00:00+02:00",
      },
    });
    expect(booking.statusCode).toBe(201);
  });
});
