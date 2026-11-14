// app/api/ambient/extract/route.ts
//
// Ambient memory extraction. Listening mode (components/AmbientListener.tsx)
// batches ~20s of recognized speech and posts it here. This route turns it
// into short structured notes and discards the text immediately after — it
// is never written to ai_memory, never logged, and never returned to the
// client.
//
// Single-user hackathon build: no auth provider wired up yet, so every
// request is attributed to one constant DEMO_USER_ID rather than a real
// per-visitor identity. Swap this for real auth before this is anything
// other than a one-person demo.
//
// POST { text, timeZone } -> { saved: number }

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AMBIENT_EXTRACT_HOURLY_CAP } from '@/lib/ambientConfig'

// No per-user auth yet — see header comment.
const DEMO_USER_ID = 'demo'

// Same cost-efficient, flat-rate model DumpNotes' lib/aiModels.ts settled
// on for this exact "extract short notes from a text snippet" job. Inlined
// here directly since this hackathon build doesn't carry over that file's
// full catalog of model ids — just the one this route actually needs.
const MODEL_ID = 'models/gemini-3.5-flash-lite'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// Lazy + memoized, not module-scope — a module-scope createClient() with
// non-null-asserted env vars throws the instant this file is imported,
// which would break a build/preview with no real env vars configured yet.
let cachedAdminClient: SupabaseClient | null = null

function getSupabaseAdmin(): SupabaseClient {
  if (cachedAdminClient) return cachedAdminClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[ambient/extract] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set')
  }

  cachedAdminClient = createClient(url, key)
  return cachedAdminClient
}

// Simple in-memory hourly cap — no usage-limit service in this build.
// Resets lazily (checked on each request, not on a timer) and lives only
// for the lifetime of this server process; fine for a single-user
// hackathon demo, NOT a substitute for a real per-user rate limiter once
// this has more than one visitor.
let callsUsedThisWindow = 0
let windowStartedAt = Date.now()
const HOUR_MS = 60 * 60 * 1000

function consumeExtractCall(): boolean {
  const now = Date.now()
  if (now - windowStartedAt >= HOUR_MS) {
    callsUsedThisWindow = 0
    windowStartedAt = now
  }
  if (callsUsedThisWindow + 1 > AMBIENT_EXTRACT_HOURLY_CAP) return false
  callsUsedThisWindow += 1
  return true
}

const VALID_TYPES = ['plan', 'fact', 'preference', 'decision']

// Below this, a 20s batch is almost certainly silence-with-noise or a
// stray word, not worth an AI call.
const MIN_CHARS = 12

export async function POST(req: NextRequest) {
  if (!consumeExtractCall()) {
    return NextResponse.json({ error: 'AMBIENT_LIMIT_REACHED' }, { status: 429 })
  }

  const { text, timeZone } = await req.json().catch(() => ({ text: '', timeZone: undefined }))
  const batch = typeof text === 'string' ? text.trim() : ''
  if (batch.length < MIN_CHARS) return NextResponse.json({ saved: 0 })

  const resolvedTimeZone = typeof timeZone === 'string' && timeZone ? timeZone : 'UTC'
  const now = new Date()
  let nowIso: string
  try {
    nowIso = now.toLocaleString('sv-SE', { timeZone: resolvedTimeZone }).replace(' ', 'T')
  } catch {
    nowIso = now.toISOString().slice(0, 19)
  }

  // NOTE ON PROMPT INJECTION: the batch is the user's own spoken words,
  // picked up by their own microphone. Still delimited and labelled as
  // data, not instructions.
  const prompt = `You silently extract short, structured notes from a snippet of someone's own spoken speech, picked up in the background while they talk (a "Listening mode" feature in a voice assistant app). You are not having a conversation with them — just deciding what, if anything, is worth remembering.

The current date/time where they are is ${nowIso} (timezone: ${resolvedTimeZone}). Resolve any relative time ("tomorrow at 3pm", "next Friday") against this, and return it as a full ISO 8601 datetime with timezone offset.

Speech snippet:
"""
${batch}
"""

Extract zero or more short notes. Only extract something if it is genuinely worth remembering later — a concrete plan, a fact about the person or their life, a stated preference, or a decision they made out loud. SKIP small talk, filler, questions, and anything too vague to act on. It is correct and common to return an empty list.

Each note has:
- type: one of "plan", "fact", "preference", "decision"
- summary: one short plain sentence
- when_iso: ISO 8601 datetime with offset, ONLY if the note has an actual specific time attached — omit entirely otherwise
- people: array of names mentioned in connection with this note, omit if none
- confidence: 0-1, how sure you are this was genuinely worth remembering

Respond with only the notes.`

  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                type: { type: SchemaType.STRING, enum: VALID_TYPES },
                summary: { type: SchemaType.STRING },
                when_iso: { type: SchemaType.STRING },
                people: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                confidence: { type: SchemaType.NUMBER },
              },
              required: ['type', 'summary', 'confidence'],
            },
          },
        },
        required: ['items'],
      } as any,
      maxOutputTokens: 1024,
      temperature: 0.2,
    },
  })

  let parsed: { items?: any[] }
  try {
    const result = await model.generateContent(prompt)
    parsed = JSON.parse(result.response.text())
  } catch (e: any) {
    // Deliberately no transcript/content in this log line.
    console.error('[ambient/extract] generation failed:', e?.message || e)
    return NextResponse.json({ saved: 0 })
  }

  const items = Array.isArray(parsed.items) ? parsed.items : []
  if (items.length === 0) return NextResponse.json({ saved: 0 })

  const rows = items
    .filter(i => i && VALID_TYPES.includes(i.type) && typeof i.summary === 'string' && i.summary.trim())
    .map(i => ({
      user_id: DEMO_USER_ID,
      type: i.type,
      summary: String(i.summary).trim().slice(0, 500),
      when_iso: typeof i.when_iso === 'string' && !Number.isNaN(Date.parse(i.when_iso)) ? i.when_iso : null,
      people: Array.isArray(i.people) ? i.people.map((p: any) => String(p)).slice(0, 10) : null,
      confidence: typeof i.confidence === 'number' ? Math.max(0, Math.min(1, i.confidence)) : null,
    }))

  if (rows.length === 0) return NextResponse.json({ saved: 0 })

  const { error: insertErr } = await getSupabaseAdmin().from('ai_memory').insert(rows)
  if (insertErr) {
    console.error('[ambient/extract] insert failed:', insertErr.message)
    return NextResponse.json({ saved: 0 })
  }

  return NextResponse.json({ saved: rows.length })
}
