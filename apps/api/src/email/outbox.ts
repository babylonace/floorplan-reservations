import type { PoolClient } from "pg";
import type { Pool } from "../db.js";
import { maskEmail, type Mailer } from "./mailer.js";
import { renderEmail, type EmailFacts, type EmailKind } from "./templates.js";

/**
 * The e-mail queue. Booking changes add rows in their own transaction; `deliverDueEmails`
 * sends them later. A failed send is tried again after a wait that grows each time, and never
 * touches the booking.
 */

type Queryable = Pick<PoolClient, "query">;

/** Waits before each new try, in minutes. After the last one the queue gives up. */
export const RETRY_MINUTES = [1, 5, 15, 60, 180] as const;
/** A worker that stopped halfway leaves its rows; another one picks them up after this. */
const CLAIM_MINUTES = 10;
const BATCH = 20;

/** Queues "we have your booking" for the guest and "new booking" for each owner of the venue. */
export async function queueNewBookingEmails(db: Queryable, reservationId: string): Promise<void> {
  await db.query(
    `insert into email_outbox (reservation_id, kind, recipient, locale)
     select id, 'guest_received'::email_kind, guest_email, locale
       from reservations where id = $1 and guest_email is not null
     union all
     select r.id, 'venue_new_booking'::email_kind, u.email, v.default_locale
       from reservations r
       join venues v on v.id = r.venue_id
       join venue_staff vs on vs.venue_id = v.id and vs.role = 'owner'
       join staff_users u on u.id = vs.user_id
      where r.id = $1`,
    [reservationId],
  );
}

/** Queues the guest's message for a new status, when that status has one. */
export async function queueStatusEmail(
  db: Queryable,
  reservationId: string,
  status: string,
): Promise<void> {
  const kind: EmailKind | null =
    status === "confirmed" ? "guest_confirmed" : status === "cancelled" ? "guest_cancelled" : null;
  if (!kind) return;
  await db.query(
    `insert into email_outbox (reservation_id, kind, recipient, locale)
     select id, $2::email_kind, guest_email, locale from reservations where id = $1 and guest_email is not null`,
    [reservationId, kind],
  );
}

interface ClaimedRow {
  id: string;
  reservation_id: string;
  kind: EmailKind;
  recipient: string;
  locale: string;
  attempts: number;
}

interface FactsRow {
  venue_name: string;
  time_zone: string;
  starts_at: Date;
  party_size: number;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  notes: string | null;
  tables: string;
}

async function loadFacts(db: Queryable, reservationId: string): Promise<EmailFacts | null> {
  const { rows } = await db.query<FactsRow>(
    `select v.name as venue_name, v.time_zone, r.starts_at, r.party_size, r.guest_name,
            r.guest_email, r.guest_phone, r.notes,
            coalesce((select string_agg(z.name || ' · ' || t.label, ', ' order by z.sort_order, t.label)
                        from reservation_tables rt
                        join dining_tables t on t.id = rt.table_id
                        join zones z on z.id = t.zone_id
                       where rt.reservation_id = r.id), '') as tables
       from reservations r join venues v on v.id = r.venue_id
      where r.id = $1`,
    [reservationId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    venueName: row.venue_name,
    timeZone: row.time_zone,
    startsAt: row.starts_at,
    partySize: row.party_size,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    notes: row.notes,
    tables: row.tables,
  };
}

/** An error message for the queue and the log, with any e-mail address in it masked. */
export function safeErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, (address) => maskEmail(address))
    .slice(0, 500);
}

interface Log {
  info: (details: object, message: string) => void;
  warn: (details: object, message: string) => void;
}

/**
 * Sends the messages that are due, a batch at a time, and returns how many went out. Each row
 * is claimed first, so two workers (or two copies of the API) never send the same message.
 */
export async function deliverDueEmails(
  pool: Pool,
  mailer: Mailer,
  now: Date,
  log: Log,
): Promise<number> {
  let sent = 0;
  for (;;) {
    const { rows } = await pool.query<ClaimedRow>(
      `with due as (
         select id from email_outbox
          where next_attempt_at <= $1
          order by next_attempt_at
          limit $2
          for update skip locked
       )
       update email_outbox o
          set attempts = o.attempts + 1,
              next_attempt_at = $1::timestamptz + make_interval(mins => $3)
         from due where o.id = due.id
       returning o.id, o.reservation_id, o.kind, o.recipient, o.locale, o.attempts`,
      [now, BATCH, CLAIM_MINUTES],
    );
    if (rows.length === 0) return sent;

    for (const row of rows) {
      try {
        const facts = await loadFacts(pool, row.reservation_id);
        // The booking was deleted after the message was queued: nothing to say any more.
        if (facts) {
          await mailer.send({ to: row.recipient, ...renderEmail(row.kind, row.locale, facts) });
          sent += 1;
        }
        await pool.query("delete from email_outbox where id = $1", [row.id]);
      } catch (error) {
        const wait = RETRY_MINUTES[row.attempts - 1];
        const reason = safeErrorText(error);
        await pool.query(
          `update email_outbox set last_error = $2,
                  next_attempt_at = case when $3::int is null then null
                                         else $4::timestamptz + make_interval(mins => $3::int) end
            where id = $1`,
          [row.id, reason, wait ?? null, now],
        );
        log.warn(
          { kind: row.kind, to: maskEmail(row.recipient), attempts: row.attempts, reason },
          wait === undefined ? "E-mail failed; giving up" : "E-mail failed; will try again",
        );
      }
    }
  }
}

export interface EmailWorker {
  /** Sends what is due soon, without waiting. Calls while a round runs start one more after it. */
  kick(): void;
  /** Stops the timer and waits for the round in progress. */
  stop(): Promise<void>;
}

/** Sends due messages every `intervalMs`, and whenever `kick` says new ones were queued. */
export function startEmailWorker(options: {
  pool: Pool;
  mailer: Mailer;
  now: () => Date;
  log: Log & { error: (details: object, message: string) => void };
  intervalMs: number;
}): EmailWorker {
  const { pool, mailer, now, log } = options;
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;

  const round = (): void => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = deliverDueEmails(pool, mailer, now(), log)
      .then(
        () => undefined,
        (error: unknown) => {
          log.error({ reason: safeErrorText(error) }, "E-mail queue failed");
        },
      )
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          round();
        }
      });
  };

  const timer = setInterval(round, options.intervalMs);
  timer.unref();
  return {
    kick: round,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      while (running) await running;
    },
  };
}
