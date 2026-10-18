-- Delivery-zone pricing table, editable from the admin panel, plus the
-- order columns needed to store which zone/distance an order was charged.
-- See lib/deliveryZones.js for the classification logic that reads this.

create table if not exists delivery_zones (
  zone_num integer primary key,
  label text not null,
  fee numeric not null default 0,
  updated_at timestamptz not null default now()
);

insert into delivery_zones (zone_num, label, fee) values
  (1, 'Zone 1 — Free Delivery', 0),
  (2, 'Zone 2 — Local Delivery', 20),
  (3, 'Zone 3 — Extended Miami', 50),
  (4, 'Zone 4 — North Broward', 65),
  (5, 'Zone 5 — Distant Delivery', 80)
on conflict (zone_num) do nothing;

alter table orders add column if not exists zone_num integer;
alter table orders add column if not exists driving_distance_miles numeric;
