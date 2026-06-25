-- Phase 2.4: Daily summary table for cross-device reporting.
-- One row per (business_id, device_id, date).
-- id is derived deterministically as "businessId:deviceId:date" — no UUID needed.

create table if not exists public.pos_year_history (
  id          text        primary key,
  business_id text        not null,
  device_id   text        not null,
  date        text        not null,   -- YYYY-MM-DD
  summary     jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Anon access for Phase 2.x (no auth yet — Phase 3 adds Supabase Auth + RLS policies).
alter table public.pos_year_history enable row level security;

create policy "anon_all_pos_year_history"
  on public.pos_year_history
  for all
  to anon
  using (true)
  with check (true);
