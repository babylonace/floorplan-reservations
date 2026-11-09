import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createUser, grantRole } from "../src/auth/staff.js";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { maskEmail, type Mailer } from "../src/email/mailer.js";
import { deliverDueEmails, RETRY_MINUTES, safeErrorText } from "../src/email/outbox.js";
import { renderEmail } from "../src/email/templates.js";
import {
  createVenue,
  deleteVenue,
  newGuestEmail,
  ownerCookie,
  signIn,
  TEST_APP_OPTIONS,
  TEST_NOW,
  TEST_OWNER_EMAIL,
  TEST_PASSWORD,
  testDatabaseUrl,
} from "./helpers.js";

interface ServiceReservation {
  id: string;
  status: string;
  startsAt: string;
  partySize: number;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  notes: string | null;
  locale: string;
  tables: { id: string; label: string; zoneId: string; zoneName: string }[];
}

const pool = createPool(testDatabaseUrl());
let app: FastifyInstance;
let owner: string;
const slugs: string[] = [];
const WAITER = "service-waiter@example.com";
const silent = { info: () => undefined, warn: () => undefined };

beforeAll(async () => {
  app = await buildApp({ pool, ...TEST_APP_OPTIONS });
  owner = await ownerCookie(app);
  await createUser(pool, WAITER, TEST_PASSWORD);
});

afterEach(async () => {
  for (const slug of slugs.splice(0)) await deleteVenue(pool, slug);
  await pool.query("delete from email_outbox");
});

afterAll(async () => {
  await pool.query("delete from staff_users where email = $1", [WAITER]);
  await app.close();
  await pool.end();
});

async function venue(slug: string, tables = [{ label: "T1", x: 100 }]) {
  slugs.push(slug);
  return createVenue(pool, slug, tables);
}

async function book(slug: string, body: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: `/venues/${slug}/reservations`,
    payload: {
      guestName: "Ana Test",
      guestEmail: newGuestEmail(),
      partySize: 2,
      startsAt: "2030-06-01T20:00:00+02:00",
      ...body,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

function day(slug: string, date: string, cookie = owner) {
  return app.inject({
    method: "GET",
    url: `/venues/${slug}/reservations?date=${date}`,
    headers: { cookie },
  });
}

function setStatus(slug: string, id: string, status: string, cookie = owner) {
  return app.inject({
    method: "PATCH",
    url: `/venues/${slug}/reservations/${id}`,
    headers: { cookie },
    payload: { status },
  });
}

function capture(): Mailer & { sent: { to: string; subject: string; text: string }[] } {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    kind: "smtp",
    sent,
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

describe("GET /venues/:slug/reservations", () => {
  it("lists the day's bookings in arrival order, with the guest's details and tables", async () => {
    await venue("svc-day", [
      { label: "T1", x: 100 },
      { label: "T2", x: 300 },
    ]);
    const late = await book("svc-day", { startsAt: "2030-06-01T21:30:00+02:00" });
    const early = await book("svc-day", {
      startsAt: "2030-06-01T13:00:00+02:00",
      guestPhone: "+34 600 000 000",
      notes: "Window, please",
      locale: "en",
    });
    // Another day, and just after midnight local time, which is still 1 June in UTC.
    await book("svc-day", { startsAt: "2030-06-02T00:30:00+02:00" });

    const response = await day("svc-day", "2030-06-01");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<{ timeZone: string; reservations: ServiceReservation[] }>();
    expect(body.timeZone).toBe("Europe/Madrid");
    expect(body.reservations.map((r) => r.id)).toEqual([early, late]);
    expect(body.reservations[0]).toMatchObject({
      status: "pending",
      startsAt: "2030-06-01T11:00:00.000Z",
      partySize: 2,
      guestName: "Ana Test",
      guestPhone: "+34 600 000 000",
      notes: "Window, please",
      locale: "en",
      tables: [{ zoneName: "Room" }],
    });
  });

  it("lets plain staff of the venue in, and nobody else", async () => {
    await venue("svc-who");
    await book("svc-who");
    expect(
      (await app.inject({ url: "/venues/svc-who/reservations?date=2030-06-01" })).statusCode,
    ).toBe(401);

    const waiter = await signIn(app, WAITER, TEST_PASSWORD);
    expect((await day("svc-who", "2030-06-01", waiter)).statusCode).toBe(403);

    const { rows } = await pool.query<{ id: string }>(
      "select id from staff_users where email = $1",
      [WAITER],
    );
    await grantRole(pool, rows[0]?.id ?? "", "svc-who", "staff");
    const response = await day("svc-who", "2030-06-01", waiter);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ reservations: unknown[] }>().reservations).toHaveLength(1);
  });

  it("refuses a day that does not exist", async () => {
    await venue("svc-bad-day");
    expect((await day("svc-bad-day", "2030-02-30")).statusCode).toBe(400);
    expect((await day("svc-bad-day", "tomorrow")).statusCode).toBe(400);
  });
});

describe("PATCH /venues/:slug/reservations/:id", () => {
  it("confirms, seats and refuses to bring back a finished booking", async () => {
    await venue("svc-flow");
    const id = await book("svc-flow");

    const confirmed = await setStatus("svc-flow", id, "confirmed");
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<ServiceReservation>().status).toBe("confirmed");
    // Asking twice changes nothing and is not an error (a double tap).
    expect((await setStatus("svc-flow", id, "confirmed")).statusCode).toBe(200);

    expect((await setStatus("svc-flow", id, "seated")).json<ServiceReservation>().status).toBe(
      "seated",
    );
    const back = await setStatus("svc-flow", id, "cancelled");
    expect(back.statusCode).toBe(409);
    expect(back.json<{ code: string }>().code).toBe("status_not_allowed");
    expect((await setStatus("svc-flow", id, "completed")).statusCode).toBe(400);
  });

  it("frees the table when a booking is cancelled or marked as a no-show", async () => {
    await venue("svc-free");
    const first = await book("svc-free");
    // The only table is taken.
    const refused = await app.inject({
      method: "POST",
      url: "/venues/svc-free/reservations",
      payload: {
        guestName: "Other",
        guestEmail: newGuestEmail(),
        partySize: 2,
        startsAt: "2030-06-01T20:00:00+02:00",
      },
    });
    expect(refused.statusCode).toBe(409);

    expect((await setStatus("svc-free", first, "cancelled")).statusCode).toBe(200);
    const second = await book("svc-free");
    expect((await setStatus("svc-free", second, "no_show")).statusCode).toBe(200);
    await book("svc-free");
  });

  it("answers 404 for a booking of another venue, and 403 to staff of another venue", async () => {
    await venue("svc-mine");
    await venue("svc-theirs");
    const theirs = await book("svc-theirs");
    expect((await setStatus("svc-mine", theirs, "confirmed")).statusCode).toBe(404);

    await pool.query(
      "delete from venue_staff where venue_id = (select id from venues where slug = 'svc-theirs')",
    );
    expect((await setStatus("svc-theirs", theirs, "confirmed")).statusCode).toBe(403);
  });
});

describe("e-mails", () => {
  it("queues the guest's and the owners' messages with the booking, in their languages", async () => {
    await venue("svc-mail");
    const guest = newGuestEmail();
    const id = await book("svc-mail", { guestEmail: guest, locale: "en" });

    const { rows } = await pool.query<{ kind: string; recipient: string; locale: string }>(
      "select kind, recipient, locale from email_outbox where reservation_id = $1 order by kind",
      [id],
    );
    expect(rows).toEqual([
      { kind: "guest_received", recipient: guest, locale: "en" },
      { kind: "venue_new_booking", recipient: TEST_OWNER_EMAIL, locale: "es" },
    ]);

    const mailer = capture();
    expect(await deliverDueEmails(pool, mailer, TEST_NOW, silent)).toBe(2);
    const toGuest = mailer.sent.find((m) => m.to === guest);
    expect(toGuest?.subject).toBe("We have your booking at svc-mail");
    expect(toGuest?.text).toContain("Saturday, June 1 at 20:00");
    const toVenue = mailer.sent.find((m) => m.to === TEST_OWNER_EMAIL);
    expect(toVenue?.subject).toContain("Nueva reserva");
    expect(toVenue?.text).toContain(guest);
    expect(toVenue?.text).toContain("Room · T1");
    // Sent messages leave the queue.
    expect((await pool.query("select 1 from email_outbox")).rows).toHaveLength(0);
  });

  it("e-mails the guest when staff confirm or cancel, and not for seated or no-show", async () => {
    await venue("svc-mail-status");
    await pool.query(
      "update venues set locales = array['es', 'en', 'ar'] where slug = 'svc-mail-status'",
    );
    const id = await book("svc-mail-status", { locale: "ar" });
    await pool.query("delete from email_outbox");

    await setStatus("svc-mail-status", id, "confirmed");
    await setStatus("svc-mail-status", id, "confirmed");
    await setStatus("svc-mail-status", id, "cancelled");
    const other = await book("svc-mail-status", { guestEmail: undefined, guestPhone: "600000000" });
    await setStatus("svc-mail-status", other, "seated");

    const mailer = capture();
    await deliverDueEmails(pool, mailer, TEST_NOW, silent);
    expect(mailer.sent.map((m) => m.subject)).toEqual([
      "تم تأكيد حجزك في svc-mail-status",
      "تم إلغاء حجزك في svc-mail-status",
      // The phone-only guest gets nothing; the owner hears about the new booking.
      expect.stringContaining("Nueva reserva") as unknown as string,
    ]);
  });

  it("keeps the booking when sending fails, and tries again later", async () => {
    await venue("svc-mail-fail");
    const guest = newGuestEmail();
    const id = await book("svc-mail-fail", { guestEmail: guest });
    const broken: Mailer = {
      kind: "smtp",
      send: (message) => Promise.reject(new Error(`550 mailbox ${message.to} unavailable`)),
    };
    const warnings: object[] = [];
    const log = { info: () => undefined, warn: (details: object) => warnings.push(details) };

    expect(await deliverDueEmails(pool, broken, TEST_NOW, log)).toBe(0);
    const { rows } = await pool.query<{
      attempts: number;
      next_attempt_at: Date;
      last_error: string;
    }>("select attempts, next_attempt_at, last_error from email_outbox where recipient = $1", [
      guest,
    ]);
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.next_attempt_at).toEqual(new Date(TEST_NOW.getTime() + 60_000));
    // The address is never stored or logged in full.
    expect(rows[0]?.last_error).toBe(`550 mailbox ${maskEmail(guest)} unavailable`);
    expect(JSON.stringify(warnings)).not.toContain(guest);
    expect(
      (await day("svc-mail-fail", "2030-06-01")).json<{ reservations: { id: string }[] }>()
        .reservations[0]?.id,
    ).toBe(id);

    // Not due again yet; once due, a working server sends it.
    const mailer = capture();
    expect(await deliverDueEmails(pool, mailer, TEST_NOW, log)).toBe(0);
    const later = new Date(TEST_NOW.getTime() + 2 * 60_000);
    expect(await deliverDueEmails(pool, mailer, later, log)).toBe(2);
  });

  it("gives up after the last retry", async () => {
    await venue("svc-mail-give-up");
    await book("svc-mail-give-up");
    const broken: Mailer = { kind: "smtp", send: () => Promise.reject(new Error("down")) };
    let at = TEST_NOW;
    for (let round = 0; round <= RETRY_MINUTES.length; round++) {
      await deliverDueEmails(pool, broken, at, silent);
      at = new Date(at.getTime() + 24 * 60 * 60_000);
    }
    const { rows } = await pool.query<{ attempts: number; next_attempt_at: Date | null }>(
      "select attempts, next_attempt_at from email_outbox",
    );
    expect(rows.every((row) => row.attempts === RETRY_MINUTES.length + 1)).toBe(true);
    expect(rows.every((row) => row.next_attempt_at === null)).toBe(true);
  });
});

describe("e-mail pieces", () => {
  it("masks addresses in error messages", () => {
    expect(maskEmail("maria.lopez@example.com")).toBe("m***@example.com");
    expect(safeErrorText(new Error("RCPT <maria@example.com> refused"))).toBe(
      "RCPT <m***@example.com> refused",
    );
  });

  it("writes Spanish for the venue and falls back to English for unknown languages", () => {
    const facts = {
      venueName: "Sample Bistro",
      timeZone: "Europe/Madrid",
      startsAt: new Date("2030-06-01T18:00:00Z"),
      partySize: 1,
      guestName: "Ana",
      guestEmail: null,
      guestPhone: "600000000",
      notes: null,
      tables: "",
    };
    expect(renderEmail("guest_confirmed", "es", facts).subject).toBe(
      "Tu reserva en Sample Bistro está confirmada",
    );
    expect(renderEmail("guest_confirmed", "fr", facts).subject).toBe(
      "Your booking at Sample Bistro is confirmed",
    );
    expect(renderEmail("venue_new_booking", "es", facts).text).toContain("Contacto: 600000000");
  });

  it("reads the SMTP settings from the environment", () => {
    const base = { DATABASE_URL: "postgres://localhost/example" };
    expect(loadConfig(base).smtp).toBeUndefined();
    expect(() => loadConfig({ ...base, SMTP_HOST: "mail.example.com" })).toThrow(/MAIL_FROM/);
    expect(
      loadConfig({
        ...base,
        SMTP_HOST: "mail.example.com",
        MAIL_FROM: "b@example.com",
        SMTP_PORT: "465",
      }).smtp,
    ).toEqual({
      host: "mail.example.com",
      port: 465,
      secure: true,
      user: undefined,
      password: undefined,
      from: "b@example.com",
    });
  });
});
