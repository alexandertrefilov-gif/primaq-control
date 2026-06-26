-- Phase 3.x: Aktueller Tagesverkauf geräteübergreifend synchronisieren
--
-- Stores the live daily sales snapshot (orders + totals) for a given business day.
-- id = "businessId:businessDate" (deterministic, idempotent upserts).
-- updated_at provided by the client for Last Write Wins conflict resolution.
-- One row per business_date — the latest flush from any device wins.
--
-- Run this in the Supabase SQL Editor.

create table if not exists public.pos_sales_state (
  id            text        primary key,
  business_id   text        not null,
  business_date text        not null,
  data          jsonb       not null,
  updated_at    timestamptz not null,
  unique (business_id, business_date)
);

alter table public.pos_sales_state enable row level security;

drop policy if exists "anon_all_pos_sales_state" on public.pos_sales_state;

create policy "anon_all_pos_sales_state"
  on public.pos_sales_state
  for all
  to anon
  using (true)
  with check (true);
