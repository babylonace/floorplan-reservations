-- E-mails waiting to go out: to the guest when a booking arrives, is confirmed or is cancelled,
-- and to the venue's owners when a new booking arrives.
--
-- A row is written in the same transaction as the booking change, so a message is never lost
-- and a mail server that is down never undoes a booking. A worker sends the rows, deletes each
-- one once it is sent, and tries again later when sending fails.
--
-- The message itself is written when it is sent, from the reservation, so guest details live in
-- one place. `recipient` is copied because the venue's owners can change; deleting the
-- reservation deletes its waiting messages.
--
-- Forward only, like the other migrations.

create type email_kind as enum (
  'guest_received',
  'guest_confirmed',
  'guest_cancelled',
  'venue_new_booking'
);

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations (id) on delete cascade,
  kind email_kind not null,
  recipient text not null check (length(recipient) between 3 and 254),
  -- Language of the message: the guest's for guest messages, the venue's for the venue's.
  locale text not null,
  created_at timestamptz not null default now(),
  attempts smallint not null default 0 check (attempts >= 0),
  -- When the worker may try (again). null once it gave up; last_error says why.
  next_attempt_at timestamptz default now(),
  last_error text
);

create index email_outbox_due_idx on email_outbox (next_attempt_at) where next_attempt_at is not null;
create index email_outbox_reservation_idx on email_outbox (reservation_id);
