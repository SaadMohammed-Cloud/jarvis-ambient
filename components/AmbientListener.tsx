// components/AmbientListener.tsx
//
// "Listening mode" — a silent background listener built on the browser's
// own Web Speech API (SpeechRecognition), not a cloud audio-streaming
// service. It runs continuously and for free (recognition happens in the
// browser's own speech service) while the user works, only costing an AI
// call once every ~20s batch via POST /api/ambient/extract — and even then
// only for the short recognized TEXT, never audio.
//
// Privacy shape: nothing here is ever persisted client-side. Recognized
// text lives only in batchTextRef until the next flush, is cleared the
// instant a batch is read for sending (success or failure), and is never
// console.logged. No audio is ever captured by this component at all —
// SpeechRecognition exposes only text, never a stream that could be
// recorded even if we wanted to.

'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AMBIENT_BATCH_INTERVAL_MS } from '@/lib/ambientConfig'

const STORAGE_KEY = 'vesper-ambient-listening-v1'

type Status = 'off' | 'listening' | 'paused' | 'blocked' | 'unsupported'

// Matches "hey vesper", "Hey, Vesper!", "hey  vesper" etc. — spoken wake
// phrases rarely land with clean punctuation, so this tolerates a
// comma/extra whitespace between the two words rather than requiring an
// exact string.
const WAKE_RE = /\bhey,?\s+vesper\b/i

function getSpeechRecognitionCtor(): any {
  if (typeof window === 'undefined') return null
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

interface AmbientListenerProps {
  // True while some other feature needs the microphone (e.g. a live voice
  // session) — Listening mode stops its own recognition instance for the
  // duration (two simultaneous mic consumers is asking for trouble) and
  // resumes automatically once the other one ends.
  paused: boolean
  // Called once per detected "hey vesper", with whatever words (if any)
  // followed it in that same recognized phrase — forwarded so a follow-up
  // action isn't started with zero context on what to do.
  onWake: (trailingText: string) => void
}

export default function AmbientListener({ paused, onWake }: AmbientListenerProps) {
  const [supported, setSupported] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<Status>('off')

  const recognitionRef = useRef<any>(null)
  const batchTextRef = useRef('')
  const batchTimerRef = useRef<any>(null)
  const restartTimerRef = useRef<any>(null)
  const restartAttemptsRef = useRef(0)
  const runStartedAtRef = useRef(0)
  const enabledRef = useRef(false)
  const pausedRef = useRef(false)
  const onWakeRef = useRef(onWake)
  // Deliberate choice between .stop() (lets onend fire so our own restart
  // logic decides what happens next) and a flag telling that onend handler
  // "this stop was requested, don't treat it as an unexpected drop".
  const deliberateStopRef = useRef(false)

  useEffect(() => { onWakeRef.current = onWake }, [onWake])
  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    setSupported(!!getSpeechRecognitionCtor())
    try {
      setEnabled(localStorage.getItem(STORAGE_KEY) === '1')
    } catch {}
  }, [])

  const flushBatch = useCallback(() => {
    const batch = batchTextRef.current.trim()
    // Cleared immediately, before the network call even starts — the text
    // must not outlive this moment regardless of whether the request below
    // succeeds.
    batchTextRef.current = ''
    if (!batch) return
    fetch('/api/ambient/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: batch, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    }).catch(() => {
      // Fire-and-forget, best-effort background call. A dropped batch is
      // an accepted trade-off, not a crash — there is nothing left to
      // retry, the text is already gone.
    })
  }, [])

  const stopRecognition = useCallback(() => {
    deliberateStopRef.current = true
    try { recognitionRef.current?.stop() } catch {}
    if (batchTimerRef.current) { clearInterval(batchTimerRef.current); batchTimerRef.current = null }
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null }
    batchTextRef.current = ''
  }, [])

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor || !enabledRef.current || pausedRef.current) return

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'

    recognition.onstart = () => {
      runStartedAtRef.current = Date.now()
      setStatus('listening')
    }

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result.isFinal) continue // wake-word + batching both act on finalized text only
        const finalText: string = result[0]?.transcript || ''
        if (!finalText.trim()) continue

        const match = finalText.match(WAKE_RE)
        if (match) {
          const trailing = finalText.slice((match.index ?? 0) + match[0].length).replace(/^[\s,.:;-]+/, '').trim()
          onWakeRef.current(trailing)
          continue // this utterance was a command, not something to remember
        }

        batchTextRef.current += (batchTextRef.current ? ' ' : '') + finalText.trim()
      }
    }

    recognition.onerror = (event: any) => {
      const err = event?.error
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        // Permission denied — stop trying entirely and turn the feature
        // off rather than looping onerror/onend forever against a mic we
        // will never get. The user has to re-enable after fixing it.
        setStatus('blocked')
        enabledRef.current = false
        setEnabled(false)
        try { localStorage.setItem(STORAGE_KEY, '0') } catch {}
        return
      }
      if (err === 'audio-capture') {
        setStatus('blocked')
        enabledRef.current = false
        setEnabled(false)
        try { localStorage.setItem(STORAGE_KEY, '0') } catch {}
        return
      }
      // 'no-speech', 'network', 'aborted', and anything else are all
      // routine for a feature meant to run continuously for hours — let
      // onend's restart logic handle recovery rather than surfacing an
      // error for normal silence.
    }

    recognition.onend = () => {
      const ranFor = Date.now() - runStartedAtRef.current
      const wasDeliberate = deliberateStopRef.current
      deliberateStopRef.current = false

      if (!enabledRef.current || pausedRef.current || wasDeliberate) {
        if (enabledRef.current && pausedRef.current) setStatus('paused')
        return
      }

      // A run that lasted a while before ending on its own (the browser's
      // ordinary continuous-recognition cycling, or a no-speech timeout) is
      // normal operation, not a failure loop — reset backoff so long
      // sessions don't accumulate an ever-growing restart delay.
      if (ranFor > 5000) restartAttemptsRef.current = 0

      const attempt = restartAttemptsRef.current++
      const delay = Math.min(300 * 2 ** attempt, 5000)
      restartTimerRef.current = setTimeout(() => startRecognition(), delay)
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
      if (!batchTimerRef.current) batchTimerRef.current = setInterval(flushBatch, AMBIENT_BATCH_INTERVAL_MS)
    } catch {
      // start() throws if a recognition instance is already running
      // (e.g. a rapid toggle) — the existing instance's own onend will
      // still fire and drive any needed restart, so this is safe to
      // swallow rather than surfacing as an error state.
    }
  }, [flushBatch])

  // Drives recognition on/off from `enabled` and `paused` together, rather
  // than two separate effects — avoids a race where both fire in the same
  // tick and briefly start-then-immediately-stop a recognition instance.
  useEffect(() => {
    enabledRef.current = enabled
    if (!supported) { setStatus('unsupported'); return }
    if (!enabled) { stopRecognition(); setStatus('off'); return }
    if (paused) { stopRecognition(); setStatus('paused'); return }
    restartAttemptsRef.current = 0
    startRecognition()
    return () => { if (!enabled) stopRecognition() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, paused, supported])

  useEffect(() => stopRecognition, [stopRecognition])

  function toggle() {
    if (!supported) return
    setEnabled(prev => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  const label =
    status === 'unsupported' ? 'Listening mode isn’t supported in this browser' :
    status === 'blocked' ? 'Microphone blocked — enable it and toggle Listening mode back on' :
    status === 'listening' ? 'Listening — say “Hey Vesper” to talk' :
    status === 'paused' ? 'Listening mode on — paused while the assistant is open' :
    'Listening mode is off'

  return createPortal(
    <button
      type="button"
      className={`ambient-pill ambient-pill--${status}`}
      onClick={toggle}
      disabled={!supported}
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      title={label}
    >
      {status === 'listening' && <span className="ai-online" aria-hidden="true" />}
      <span className="ambient-pill-text">
        {status === 'listening' ? 'Listening' : status === 'paused' ? 'Listening (paused)' : status === 'blocked' ? 'Blocked' : status === 'unsupported' ? 'Unsupported' : 'Listening mode'}
      </span>
    </button>,
    document.body
  )
}
