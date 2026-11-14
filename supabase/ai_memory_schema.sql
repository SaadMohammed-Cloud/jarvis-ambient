-- ════════════════════════════════════════════════════════════════════════
-- Vesper — ambient memory
--
-- Run this in your Supabase project's SQL editor. Safe to re-run.
--
-- Short structured notes silently extracted from "Listening mode" speech
-- by app/api/ambient/extract/route.ts — never the raw transcript or audio,
-- only what the model judged worth remembering (a plan, fact, preference,
-- or decision).
--
-- Single-user hackathon build: `user_id` defaults to 'demo' (the constant
-- DEMO_USER_ID in app/api/ambient/extract/route.ts) rather than a real
-- per-visitor identity, since there's no auth provider wired up yet.
--
-- RLS is ENABLED but has NO policies for `authenticated` or `anon` — every
-- read and write goes through the Supabase service-role key from the
-- server (app/api/ambient/extract/route.ts), never directly from the
-- browser. That's deliberate for a single-user demo with no per-row
-- ownership to check yet; add real `select_own`/`delete_own` policies
-- keyed on a real user id before this is anything other than one person's
-- own data.
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto; -- for gen_random_uuid()

create table if not exists ai_memory (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null default 'demo',
  type        text not null check (type in ('plan', 'fact', 'preference', 'decision')),
  summary     text not null,
  -- Nullable: not every remembered note has a specific time (a preference
  -- like "prefers evening study sessions" has none). Stored as timestamptz,
  -- not text — app/api/ambient/extract/route.ts resolves relative phrases
  -- ("tomorrow at 3pm") against the caller's timezone before insert, so
  -- this is always a real absolute instant by the time it lands here.
  when_iso    timestamptz,
  people      text[],
  -- 0-1 from the model's own self-reported confidence. Not constrained to
  -- check(0<=x<=1): a model occasionally returning 1.0 or a slightly-off
  -- value shouldn't fail the whole insert over a display-only field.
  confidence  numeric,
  created_at  timestamptz not null default now()
);

create index if not exists ai_memory_user_created_idx
  on ai_memory (user_id, created_at desc);

alter table ai_memory enable row level security;

-- No policies on purpose — see header. Service role bypasses RLS
-- entirely, so this table is reachable only from server-side code holding
-- SUPABASE_SERVICE_ROLE_KEY, never directly from the browser with the
-- anon key.
