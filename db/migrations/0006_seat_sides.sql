-- Which sides of a table have seats, so a bar or a table against the wall can say so.
--
-- The sides are the table's own, before it is turned: top, right, bottom, left. NULL means seats
-- all around, which is what every table had until now, so existing tables do not change. A bar
-- is drawn as short stretches with seats on one side; the booking engine takes several
-- stretches in a row for a group, and never pushes tables together along a side with seats.
-- Round tables ignore it.
--
-- Forward only, like the other migrations.

alter table dining_tables
  add column seat_sides text[] default null,
  add constraint dining_tables_seat_sides_valid check (
    seat_sides is null
    or (
      cardinality(seat_sides) between 1 and 4
      and seat_sides <@ array['top', 'right', 'bottom', 'left']::text[]
      and array_position(seat_sides, null) is null
    )
  );
