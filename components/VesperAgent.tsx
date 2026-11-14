// components/VesperAgent.tsx
//
// The actual conversational layer: a live voice session against an
// ElevenLabs Conversational AI agent, via @elevenlabs/react's
// useConversation. Three client tools let the agent act in the browser —
// recall_memory (ai_memory lookup), open_site (small allowlisted-URL
// opener), and look_at_screen (stubbed for now, screen sharing comes
// later).

'use client'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { ConversationProvider, useConversation } from '@elevenlabs/react'

interface TranscriptLine {
  id: string
  role: 'user' | 'agent'
  text: string
}

interface AllowedSite {
  url: string
  label: string
}

// name -> site, matched loosely (see findSite below) rather than requiring
// an exact string, since the agent's own wording of what the user asked
// for can vary ("whatsapp", "whats app", "whatsapp web", ...).
const ALLOWED_SITES: Record<string, AllowedSite> = {
  whatsapp: { url: 'https://web.whatsapp.com', label: 'WhatsApp' },
  gmail: { url: 'https://mail.google.com', label: 'Gmail' },
  google: { url: 'https://www.google.com', label: 'Google' },
  youtube: { url: 'https://www.youtube.com', label: 'YouTube' },
  maps: { url: 'https://maps.google.com', label: 'Maps' },
}

// Drops standalone "web"/"app" tokens and whitespace, not any occurrence
// of those LETTERS — a blind substring replace would mangle "whatsapp"
// itself (it contains "app"). "WhatsApp Web" -> "whatsapp"; "Gmail app"
// -> "gmail"; "whatsapp" -> "whatsapp", untouched.
function normalizeSiteName(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token && token !== 'web' && token !== 'app')
    .join('')
}

function findSite(name: string): AllowedSite | null {
  const normalized = normalizeSiteName(name)
  if (!normalized) return null
  let best: { key: string; site: AllowedSite } | null = null
  for (const [key, site] of Object.entries(ALLOWED_SITES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      if (!best || key.length > best.key.length) best = { key, site }
    }
  }
  return best?.site ?? null
}

let transcriptIdSeq = 0

interface VesperAgentProps {
  // Lets the page pause anything else competing for the microphone (e.g.
  // Listening mode) while a live session is connected — same
  // mutual-exclusion precedent components/AmbientListener.tsx's own
  // `paused` prop already documents.
  onActiveChange?: (active: boolean) => void
}

// Exposed via ref so a wake-word detector (e.g. AmbientListener's onWake,
// wired up in app/page.tsx) can start a session the same way the button
// does, without the two components needing to share any other state.
export interface VesperAgentHandle {
  start: () => void
}

const VesperAgentInner = forwardRef<VesperAgentHandle, VesperAgentProps>(function VesperAgentInner(
  { onActiveChange },
  ref
) {
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const recall_memory = useCallback(async ({ query }: { query: string }): Promise<string> => {
    try {
      const res = await fetch('/api/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: typeof query === 'string' ? query : '' }),
      })
      const data = await res.json().catch(() => ({ notes: [] }))
      const notes = Array.isArray(data?.notes) ? data.notes : []
      if (notes.length === 0) return 'No notes found.'

      return notes
        .map((n: any) => {
          const when = n.when_iso ? ` (${new Date(n.when_iso).toLocaleString()})` : ''
          const people = Array.isArray(n.people) && n.people.length ? ` — with ${n.people.join(', ')}` : ''
          return `${n.summary}${when}${people}`
        })
        .join('\n')
    } catch {
      return 'No notes found.'
    }
  }, [])

  const open_site = useCallback(({ name }: { name: string }): string => {
    const site = findSite(typeof name === 'string' ? name : '')
    if (!site) {
      return 'I can only open WhatsApp, Gmail, Google, YouTube or Maps.'
    }
    const win = window.open(site.url, '_blank', 'noopener')
    if (!win) {
      return 'The browser blocked the tab. Ask the user to allow popups.'
    }
    return `Opening ${site.label}.`
  }, [])

  const look_at_screen = useCallback((_args: { question: string }): string => {
    return 'Screen sharing is not set up yet.'
  }, [])

  const conversation = useConversation({
    clientTools: { recall_memory, open_site, look_at_screen },
    onMessage: props => {
      setTranscript(prev => [
        ...prev,
        { id: `${transcriptIdSeq++}`, role: props.role, text: props.message },
      ])
    },
    onError: message => {
      setError(typeof message === 'string' ? message : 'Something went wrong.')
    },
  })

  const { status, mode, startSession, endSession } = conversation

  const active = status === 'connected' || status === 'connecting'
  useEffect(() => {
    onActiveChange?.(active)
  }, [active, onActiveChange])

  const handleStart = useCallback(async () => {
    if (status !== 'disconnected' && status !== 'error') return // already live
    setError(null)
    setStarting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
    } catch {
      setError('Microphone access was blocked. Enable it in your browser settings.')
      setStarting(false)
      return
    }

    try {
      const res = await fetch('/api/elevenlabs/signed-url')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data?.signedUrl !== 'string') {
        setError(data?.error || 'Could not start a session.')
        setStarting(false)
        return
      }
      setTranscript([])
      startSession({ signedUrl: data.signedUrl })
    } catch {
      setError('Could not reach the server to start a session.')
    } finally {
      setStarting(false)
    }
  }, [status, startSession])

  const handleStop = useCallback(() => {
    endSession()
  }, [endSession])

  useImperativeHandle(ref, () => ({ start: handleStart }), [handleStart])

  const statusLabel =
    starting || status === 'connecting' ? 'Connecting…' :
    status === 'connected' ? (mode === 'speaking' ? 'Speaking' : 'Listening') :
    status === 'error' ? 'Error' :
    'Off'

  const isLive = status === 'connected' || status === 'connecting' || starting

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      <button
        type="button"
        onClick={isLive ? handleStop : handleStart}
        disabled={starting || status === 'connecting'}
        className={`vesper-orb vesper-orb--${status}${mode === 'speaking' && status === 'connected' ? ' vesper-orb--speaking' : ''}`}
        aria-label={isLive ? 'Stop talking to Vesper' : 'Start talking to Vesper'}
      >
        <span className="vesper-orb-icon" aria-hidden="true">
          {isLive ? '■' : '●'}
        </span>
      </button>

      <p className="text-sm text-neutral-400">{statusLabel}</p>

      {error && (
        <p className="text-sm text-red-400 text-center" role="alert">
          {error}
        </p>
      )}

      {transcript.length > 0 && (
        <div className="vesper-transcript w-full">
          {transcript.map(line => (
            <p
              key={line.id}
              className={line.role === 'user' ? 'vesper-line vesper-line--user' : 'vesper-line vesper-line--agent'}
            >
              <span className="vesper-line-role">{line.role === 'user' ? 'You' : 'Vesper'}</span>
              {line.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
})

const VesperAgent = forwardRef<VesperAgentHandle, VesperAgentProps>(function VesperAgent(props, ref) {
  return (
    <ConversationProvider>
      <VesperAgentInner {...props} ref={ref} />
    </ConversationProvider>
  )
})

export default VesperAgent
