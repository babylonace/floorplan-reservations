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
  unique (venue_id, name),
  -- Lets child rows point at (zone, venue) together, so they can never mix venues.
  unique (id, venue_id)
);

create type table_shape as enum ('rect', 'round');

-- "tables" is a confusing name in SQL, so these are dining_tables.
create table dining_tables (
  id uuid primary key default gen_random_uuid(),
  -- venue_id repeats the zone's venue so reservation_tables can check that a reservation
  -- and its tables belong to the same venue. The foreign key below keeps the two in step.
  venue_id uuid not null,
  zone_id uuid not null,
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
  unique (id, venue_id),
  check (max_seats >= min_seats),
  foreign key (zone_id, venue_id) references zones (id, venue_id) on delete cascade on update cascade
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
  unique (id, venue_id),
  check (ends_at > starts_at),
  check (guest_email is not null or guest_phone is not null)
);

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger reservations_set_updated_at
  before update on reservations
  for each row execute function set_updated_at();

create index reservations_venue_starts_at_idx on reservations (venue_id, starts_at);

-- One reservation can take several tables pushed together.
-- Both foreign keys include venue_id, so a reservation can only take tables of its own venue.
create table reservation_tables (
  reservation_id uuid not null,
  table_id uuid not null,
  venue_id uuid not null,
  primary key (reservation_id, table_id),
  foreign key (reservation_id, venue_id) references reservations (id, venue_id) on delete cascade,
  -- "no action" (not "restrict") so a booked table cannot be deleted on its own, while
  -- deleting a whole venue still works: the check waits until all cascades have run.
  foreign key (table_id, venue_id) references dining_tables (id, venue_id) on delete no action
);

create index reservation_tables_table_id_idx on reservation_tables (table_id);
