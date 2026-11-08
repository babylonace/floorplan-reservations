-- Sample data for local development. The venue is made up.
-- Fixed ids so running the seed twice changes nothing.

insert into venues (id, slug, name, time_zone, default_locale, locales)
values (
  '00000000-0000-4000-8000-000000000001',
  'sample-bistro',
  'Sample Bistro',
  'Europe/Madrid',
  'es',
  array['es', 'en', 'fr']
)
on conflict (id) do nothing;

insert into zones (id, venue_id, name, sort_order, width, height)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Comedor', 0, 1200, 800),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Terraza', 1, 900, 400)
on conflict (id) do nothing;

insert into dining_tables (id, zone_id, label, min_seats, max_seats, shape, x, y, width, height, rotation, style)
values
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000101', '1', 1, 2, 'rect', 150, 150, 80, 80, 0, '{"color": "#c9a46b"}'),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000101', '2', 1, 2, 'rect', 230, 150, 80, 80, 0, '{"color": "#c9a46b"}'),
  ('00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000101', '3', 2, 4, 'round', 500, 300, 110, 110, 0, '{}'),
  ('00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000101', '4', 4, 6, 'rect', 850, 500, 180, 90, 90, '{}'),
  ('00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-000000000102', 'T1', 1, 2, 'round', 150, 200, 70, 70, 0, '{}'),
  ('00000000-0000-4000-8000-000000001006', '00000000-0000-4000-8000-000000000102', 'T2', 2, 4, 'rect', 450, 200, 120, 80, 0, '{}')
on conflict (id) do nothing;
