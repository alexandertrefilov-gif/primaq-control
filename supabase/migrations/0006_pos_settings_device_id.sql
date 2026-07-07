-- Adds device_id to pos_settings so the sync-diagnostic panel can show
-- which device last wrote a given settings key. Nullable/additive — existing
-- rows just show no device until the next successful push updates them.
--
-- Run this in the Supabase SQL Editor.

alter table public.pos_settings
  add column if not exists device_id text;
