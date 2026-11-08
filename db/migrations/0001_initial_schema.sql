-- First schema: venues, their floor plan (zones and tables) and reservations.
--
-- Floor plan units are centimetres. A table's x and y are its centre inside the zone,
-- measured from the zone's top-left corner.
--
-- What is NOT here yet: the rule that stops two reservations from sharing a table at the
-- same time. That comes in the next migration together with tests that hammer it concurrently.

create table venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) > 0),
  -- IANA name such as 'Europe/Madrid'. Opening hours and slots are read in this zone.
  time_zone text not null,
  -- Language the staff screens open in. Guests can pick any of `locales`.
  default_locale text not null default 'es',
  locales text[] not null default array['es', 'en'],
  created_at timestamptz not null default now(),
  check (default_locale = any (locales))
);

create table zones (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  unique (venue_id, name)
);

create type table_shape as enum ('rect', 'round');

-- "tables" is a confusing name in SQL, so these are dining_tables.
create table dining_tables (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references zones (id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  min_seats smallint not null check (min_seats >= 1),
  max_seats smallint not null,
  shape table_shape not null default 'rect',
  x integer not null,
  y integer not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  rotation smallint not null default 0 check (rotation between 0 and 359),
  -- Colours and similar looks for the plan editor. Never read by the booking engine.
  style jsonb not null default '{}' check (jsonb_typeof(style) = 'object'),
  -- false for tables staff keep for walk-ins or that are out of use.
  bookable boolean not null default true,
  unique (zone_id, label),
  check (max_seats >= min_seats)
);

create type reservation_status as enum (
  'pending',
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show'
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  party_size smallint not null check (party_size between 1 and 100),
  status reservation_status not null default 'pending',
  guest_name text not null check (length(trim(guest_name)) > 0),
  guest_email text,
  guest_phone text,
  -- Language the guest booked in, so messages to them go out in that language.
  locale text not null default 'es',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (guest_email is not null or guest_phone is not null)
);

create index reservations_venue_starts_at_idx on reservations (venue_id, starts_at);

-- One reservation can take several tables pushed together.
create table reservation_tables (
  reservation_id uuid not null references reservations (id) on delete cascade,
  table_id uuid not null references dining_tables (id) on delete restrict,
  primary key (reservation_id, table_id)
);

create index reservation_tables_table_id_idx on reservation_tables (table_id);
