-- Phase 3.0: POS-Einstellungen synchronisieren
--
-- Stores the full settings snapshot for a given businessId + settingsKey.
-- id = "businessId:settingsKey" (deterministic, idempotent upserts).
-- updated_at is provided by the client (never DB-defaulted) so that Last Write
-- Wins conflict resolution compares client-clock timestamps consistently.

create table if not exists public.pos_settings (
  id            text        primary key,
  business_id   text        not null,
  settings_key  text        not null,
  payload       jsonb       not null,
  device_id     text        not null,
  updated_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  unique (business_id, settings_key)
);

alter table public.pos_settings enable row level security;

create policy "anon_all_pos_settings"
  on public.pos_settings
  for all to anon
  using (true)
  with check (true);
