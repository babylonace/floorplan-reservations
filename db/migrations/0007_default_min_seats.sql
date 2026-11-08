-- Set min_seats to 1 for all existing tables.
--
-- The editor now shows only the number of seats (max_seats), without a separate minimum.
-- min_seats defaults to 1 so the seating engine can still use it, and the column stays
-- in case it becomes optional later (e.g. "reserve large tables for groups").
--
-- Forward only, like the other migrations.

update dining_tables
  set min_seats = 1
  where min_seats is null or min_seats <> 1;
