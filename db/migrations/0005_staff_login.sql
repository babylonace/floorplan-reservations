-- Staff sign-in: accounts, which venues each account may run and with what role, sessions,
-- and a count of failed sign-ins per e-mail address.
--
-- Forward only, like the other migrations.

create table staff_users (
  id uuid primary key default gen_random_uuid(),
  -- Stored trimmed and in lower case, so one address can only have one account.
  email text not null unique
    check (email = lower(btrim(email)) and length(email) between 3 and 254 and email like '_%@_%'),
  -- scrypt with its own random salt, written as scrypt$N$r$p$salt$key (see passwords.ts).
  password_hash text not null check (password_hash like 'scrypt$%'),
  created_at timestamptz not null default now()
);

-- owner: changes the floor plan and the booking rules.
-- staff: will see and handle the day's bookings once the staff panel exists.
create type staff_role as enum ('owner', 'staff');

create table venue_staff (
  venue_id uuid not null references venues (id) on delete cascade,
  user_id uuid not null references staff_users (id) on delete cascade,
  role staff_role not null,
  primary key (venue_id, user_id)
);

create index venue_staff_user_idx on venue_staff (user_id);

create table staff_sessions (
  -- SHA-256 of the token in the cookie. A copy of this table does not let anyone sign in.
  token_hash bytea primary key check (length(token_hash) = 32),
  user_id uuid not null references staff_users (id) on delete cascade,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  -- Moves forward on every use, up to a fixed limit counted from created_at.
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index staff_sessions_user_idx on staff_sessions (user_id);
create index staff_sessions_expires_idx on staff_sessions (expires_at);

-- Failed sign-ins per address, whether or not an account has it, so the answer never tells
-- which addresses exist. Rows older than the window are cleared as new failures come in.
create table login_failures (
  email text primary key,
  failures integer not null check (failures > 0),
  window_start timestamptz not null
);

create index login_failures_window_idx on login_failures (window_start);
