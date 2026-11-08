-- Zones guests may ask for on the public booking page, such as the dining room or the terrace.
--
-- A zone that is not offered (a private room, say) can still be given to a guest who has no
-- preference: whether its tables take online bookings at all is each table's `bookable`.
--
-- Forward only, like the other migrations.

alter table zones add column guest_selectable boolean not null default true;
