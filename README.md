# Vesper

Vesper is a voice personal assistant, built for Hack The Nest 2026. It listens in the background for the wake phrase "Hey Vesper," and silently extracts short, structured memories (plans, facts, preferences, decisions) from what it hears — never storing raw audio or full transcripts, only what's judged worth remembering.

## Pre-existing code (disclosure)

`components/AmbientListener.tsx`, `app/api/ambient/extract/route.ts`, and the `ai_memory` schema (`supabase/ai_memory_schema.sql`) were originally written by me for my earlier project, [DumpNotes](https://dumpnotes.app), and adapted here (single-user, no auth provider, in-memory rate limiting, renamed wake phrase). Everything else is new for Hack The Nest 2026.

## Setup

1. Copy `.env.example` to `.env.local` and fill in your own keys:
   ```
   cp .env.example .env.local
   ```
2. Create a **new** Supabase project (don't reuse an existing one) and run `supabase/ai_memory_schema.sql` in its SQL editor.
3. Install dependencies and run the dev server:
   ```
   npm install
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) and click the Listening mode pill (bottom right) to turn it on. Allow microphone access when prompted.
