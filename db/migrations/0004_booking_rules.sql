-- Rules for online bookings: how far ahead guests may book, and when they may arrive.
--
-- Opening hours are stored as arrival windows: the first and the last time a guest may arrive,
-- in the venue's own time zone (venues.time_zone). Storing local times instead of instants keeps
-- "dinner from 20:00" right on both sides of a daylight saving change.
--
-- - opening_hours rows with a weekday repeat every week (1 = Monday ... 7 = Sunday, as in ISO).
--   A weekday with no rows is closed.
-- - special_days lists dates that do not follow the weekly hours: a public holiday, a week off,
--   a New Year's Eve dinner. On such a date only the opening_hours rows with that on_date count.
--   A special day with no rows is closed all day.
-- - A window whose last arrival is earlier than its first arrival runs past midnight
--   (20:00 to 00:30). It belongs to the day it starts on: a closed Sunday does not cut short
--   Saturday's late window.
-- - Windows may overlap; a time is open when any window of that day allows it.
--
-- A venue with no opening hours at all takes no online bookings. That includes every venue
-- created before this migration, until staff set their hours.

alter table venues
  add column booking_horizon_days smallint not null default 60
    check (booking_horizon_days between 1 and 730);

comment on column venues.booking_horizon_days is
  'Guests may book from today up to this many days ahead, counted in the venue''s time zone.';

create table special_days (
  venue_id uuid not null references venues (id) on delete cascade,
  day date not null,
  primary key (venue_id, day)
);

create table opening_hours (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  weekday smallint check (weekday between 1 and 7),
  on_date date,
  first_arrival time not null,
  last_arrival time not null,
  -- Every window is either weekly or for one special day, never both.
  check (num_nonnulls(weekday, on_date) = 1),
  -- A window for a date needs that date listed as a special day, so the weekly hours of that
  -- date are clearly replaced and not added to. Removing the special day removes its windows.
  foreign key (venue_id, on_date) references special_days (venue_id, day) on delete cascade
);

create index opening_hours_venue_weekday_idx on opening_hours (venue_id, weekday)
  where weekday is not null;
create index opening_hours_venue_on_date_idx on opening_hours (venue_id, on_date)
  where on_date is not null;
