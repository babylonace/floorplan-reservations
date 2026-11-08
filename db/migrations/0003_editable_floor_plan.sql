-- Staff can now edit the floor plan through the API. Removing a zone or a table must not lose
-- the history of past bookings, so a table that was ever booked is retired instead of deleted:
-- it leaves the plan and the booking engine, while old reservations still point at it.
--
-- A retired table keeps its row and its label, so the label has to be free again for a new
-- table. Uniqueness of zone names and table labels now only counts rows still in use.
--
-- Forward only. Once a retired table shares its label with a new one, the old unique
-- constraints cannot be put back, and older versions of the app would show retired tables on
-- the plan (they could still never be booked, because retired tables are not bookable).

alter table zones
  add column retired_at timestamptz;

alter table dining_tables
  add column retired_at timestamptz,
  -- A retired table can never be booked again.
  add constraint dining_tables_retired_not_bookable check (retired_at is null or not bookable);

alter table zones drop constraint zones_venue_id_name_key;
create unique index zones_venue_id_name_key on zones (venue_id, name) where retired_at is null;

alter table dining_tables drop constraint dining_tables_zone_id_label_key;
create unique index dining_tables_zone_id_label_key on dining_tables (zone_id, label)
  where retired_at is null;
