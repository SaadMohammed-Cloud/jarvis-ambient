// lib/ambientConfig.ts
//
// Shared constants between components/AmbientListener.tsx (batches speech
// on this interval) and app/api/ambient/extract/route.ts (enforces the
// hourly cap). Kept in one place for the same reason
// lib/assistantConfig.ts exists — a prototype feature with its own cost
// shape shouldn't have its numbers hardcoded in two files that can drift.

// How often Listening mode flushes its in-memory speech buffer to
// POST /api/ambient/extract. ~20s per REQUIREMENTS.4 — long enough that a
// batch usually contains a complete thought, short enough that "remember
// this" doesn't feel delayed.
export const AMBIENT_BATCH_INTERVAL_MS = 20_000

// Hard ceiling on extract calls per user per hour, independent of the
// shared Gemini token budget — see the comment on ai_memory_extract_usage
// in supabase/ai_memory_schema.sql for why this exists as its own cap.
// At one call per batch interval, continuous listening for a full hour
// would make ~180 calls; this caps the worst case well below that while
// still comfortably covering genuine real use (an hour of mostly-silent
// background listening makes far fewer calls, since silence produces
// nothing to extract).
export const AMBIENT_EXTRACT_HOURLY_CAP = 60

// Default retention window shown in app/brain/page.tsx — notes older than
// this are swept on page load. Stored client-side (localStorage) since this
// is a prototype-grade preference, not a billing-relevant limit.
export const AMBIENT_DEFAULT_RETENTION_DAYS = 7
