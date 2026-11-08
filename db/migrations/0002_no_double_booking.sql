-- No table can be booked twice at the same time. PostgreSQL enforces it, not the app, so it
-- holds however many requests arrive at once and whatever code writes to the database.
--
-- How it works:
-- 1. Each reservation gets two derived columns: `during` (its time as a range) and
--    `holds_tables` (false once it is cancelled or a no-show, which frees its tables).
-- 2. reservation_tables keeps a copy of both. The copy is part of the foreign key to the
--    reservation with "on update cascade", so moving or cancelling a reservation updates the
--    copy in the same statement. The copy can never drift from the reservation.
-- 3. An exclusion constraint on reservation_tables rejects two rows for the same table whose
--    ranges overlap, counting only rows that still hold their tables.
--
-- Ranges are half-open, [start, end): a booking that ends at 21:30 and one that starts at 21:30
-- do not overlap.

-- Lets a GiST index compare plain uuids with "=" next to the range's "&&".
create extension if not exists btree_gist;

alter table reservations
  add column during tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  add column holds_tables boolean generated always as (status not in ('cancelled', 'no_show')) stored,
  add constraint reservations_table_hold_key unique (id, venue_id, during, holds_tables);

alter table reservation_tables
  add column during tstzrange,
  add column holds_tables boolean;

-- Rows written before this migration copy their reservation's values.
update reservation_tables rt
   set during = r.during,
       holds_tables = r.holds_tables
  from reservations r
 where r.id = rt.reservation_id;

alter table reservation_tables
  alter column during set not null,
  alter column holds_tables set not null,
  drop constraint reservation_tables_reservation_id_venue_id_fkey,
  add constraint reservation_tables_reservation_fkey
    foreign key (reservation_id, venue_id, during, holds_tables)
    references reservations (id, venue_id, during, holds_tables)
    on update cascade on delete cascade;

-- Whoever inserts a row only names the reservation and the table; the copy is filled in here.
-- The foreign key above still checks it, so a wrong value can never be stored.
create function reservation_tables_copy_hold() returns trigger
language plpgsql as $$
begin
  select r.during, r.holds_tables
    into new.during, new.holds_tables
    from reservations r
   where r.id = new.reservation_id;
  return new;
end;
$$;

create trigger reservation_tables_copy_hold
  before insert on reservation_tables
  for each row execute function reservation_tables_copy_hold();

alter table reservation_tables
  add constraint reservation_tables_no_double_booking
    exclude using gist (table_id with =, during with &&) where (holds_tables);
