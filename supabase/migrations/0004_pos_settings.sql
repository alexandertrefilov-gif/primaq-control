-- Phase 3.0: POS-Einstellungen synchronisieren
--
-- Stores the full settings snapshot for a given businessId + settingsKey.
-- id = "businessId:settingsKey" (deterministic, idempotent upserts).
-- updated_at is provided by the client (never DB-defaulted) so that Last Write
-- Wins conflict resolution compares client-clock timestamps consistently.
--
-- NOTE: Uses public.settings (not public.pos_settings) — the Supabase instance
-- already has a table named "settings". Run this migration only if the table
-- does not yet exist or is missing required columns.

create table if not exists public.settings (
  id            text        primary key,
  business_id   text        not null,
  settings_key  text        not null,
  payload       jsonb       not null,
  device_id     text        not null,
  updated_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  unique (business_id, settings_key)
);

alter table public.settings enable row level security;

create policy "anon_all_settings"
  on public.settings
  for all to anon
  using (true)
  with check (true);
