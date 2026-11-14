// app/api/elevenlabs/signed-url/route.ts
//
// Server-side only: exchanges our ElevenLabs API key for a short-lived
// signed WebSocket URL the browser can connect with directly. The real
// ELEVENLABS_API_KEY never reaches the client — only the signed URL does,
// which is scoped to one agent and expires on its own.
//
// GET -> { signedUrl }

import { NextResponse } from 'next/server'

const ELEVENLABS_SIGNED_URL_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url'

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY
  const agentId = process.env.ELEVENLABS_AGENT_ID

  if (!apiKey || !agentId) {
    return NextResponse.json(
      { error: 'Server is missing ELEVENLABS_API_KEY and/or ELEVENLABS_AGENT_ID.' },
      { status: 500 }
    )
  }

  try {
    const res = await fetch(`${ELEVENLABS_SIGNED_URL_ENDPOINT}?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { 'xi-api-key': apiKey },
    })

    if (!res.ok) {
      // Deliberately no response body from ElevenLabs in this log — avoid
      // echoing anything that could carry the key or agent config back out.
      console.error('[elevenlabs/signed-url] upstream request failed:', res.status)
      return NextResponse.json({ error: 'Could not get a signed URL from ElevenLabs.' }, { status: 502 })
    }

    const data = await res.json()
    const signedUrl = data?.signed_url
    if (typeof signedUrl !== 'string' || !signedUrl) {
      return NextResponse.json({ error: 'ElevenLabs did not return a signed URL.' }, { status: 502 })
    }

    return NextResponse.json({ signedUrl })
  } catch (e: any) {
    console.error('[elevenlabs/signed-url] request failed:', e?.message || e)
    return NextResponse.json({ error: 'Could not reach ElevenLabs.' }, { status: 502 })
  }
}
