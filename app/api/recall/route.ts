// app/api/recall/route.ts
//
// Keyword search over ai_memory for the recall_memory client tool
// (components/VesperAgent.tsx). Single-user build — always scoped to
// user_id = 'demo', same constant app/api/ambient/extract/route.ts writes
// under.
//
// POST { query } -> { notes: [{ type, summary, when_iso, people }] }

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEMO_USER_ID = 'demo'
const MAX_QUERY_LENGTH = 200
const MAX_RESULTS = 5

// Lazy + memoized, not module-scope — a module-scope createClient() with
// non-null-asserted env vars throws the instant this file is imported,
// which would break a build/preview with no real env vars configured yet.
let cachedAdminClient: SupabaseClient | null = null

function getSupabaseAdmin(): SupabaseClient {
  if (cachedAdminClient) return cachedAdminClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[recall] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set')
  }

  cachedAdminClient = createClient(url, key)
  return cachedAdminClient
}

// PostgREST's .or() filter string is built by hand below, so each word
// needs the characters that are syntactically meaningful to IT stripped —
// not a SQL-injection concern (the values are still sent as a query param,
// not interpolated into raw SQL), but `,` `(` `)` could otherwise reshape
// the filter's structure, and `%`/`_` are ilike wildcards a caller
// shouldn't get to inject.
function sanitizeWord(word: string): string {
  return word.replace(/[,()%_]/g, '')
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const rawQuery = body?.query

  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH)
  const words = query
    .split(/\s+/)
    .map(sanitizeWord)
    .filter(Boolean)

  if (words.length === 0) return NextResponse.json({ notes: [] })

  const orFilter = words.map(w => `summary.ilike.%${w}%`).join(',')

  const { data, error } = await getSupabaseAdmin()
    .from('ai_memory')
    .select('type, summary, when_iso, people, created_at')
    .eq('user_id', DEMO_USER_ID)
    .or(orFilter)
    .order('created_at', { ascending: false })
    .limit(MAX_RESULTS)

  if (error) {
    console.error('[recall] query failed:', error.message)
    return NextResponse.json({ notes: [] })
  }

  const notes = (data ?? []).map(row => ({
    type: row.type,
    summary: row.summary,
    when_iso: row.when_iso,
    people: row.people,
  }))

  return NextResponse.json({ notes })
}
