-- Muayene Takip: bulut senkron tabloları
-- Supabase Dashboard → SQL Editor'da çalıştırın.
-- Tek ekip, girişsiz model: anon anahtarıyla okuma+yazma (RLS açık, ekip politikası).

create table if not exists buildings (
  id text primary key,
  name text not null,
  apartment_count int not null default 0,
  direction_status text not null default '',
  info_note text,
  updated_at timestamptz not null default now()
);

create table if not exists apartments (
  id uuid primary key default gen_random_uuid(),
  building_id text not null references buildings(id) on delete cascade,
  no int not null,
  status text not null default 'bekliyor',
  serial text not null default '',
  old_index text not null default '',
  note text not null default '',
  inspection boolean not null default false,
  updated_at timestamptz,
  unique (building_id, no)
);

create index if not exists apartments_building_idx on apartments(building_id);

alter table buildings enable row level security;
alter table apartments enable row level security;

drop policy if exists "team all buildings" on buildings;
create policy "team all buildings" on buildings
  for all to anon using (true) with check (true);

drop policy if exists "team all apartments" on apartments;
create policy "team all apartments" on apartments
  for all to anon using (true) with check (true);
