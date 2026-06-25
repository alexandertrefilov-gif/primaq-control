-- Phase 2.3: Health-check table for verifying Supabase connectivity.
-- Written by SyncService.init() on every app start when online.
-- One row per device, keyed as "hc-{deviceId}".

create table if not exists public.sync_health (
  id         text        primary key,
  device_id  text        not null,
  status     text        not null,
  created_at timestamptz not null default now()
);

-- Anon access for Phase 2.x (no auth yet — Phase 3 will add Supabase Auth).
alter table public.sync_health enable row level security;

create policy "anon_all_sync_health"
  on public.sync_health
  for all
  to anon
  using (true)
  with check (true);
