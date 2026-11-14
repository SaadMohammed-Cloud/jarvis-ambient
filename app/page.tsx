// app/page.tsx
//
// Vesper's home page: the live conversational agent (VesperAgent) plus
// Listening mode (AmbientListener), both in one view. AmbientListener is
// paused whenever VesperAgent holds the mic — two simultaneous mic
// consumers is asking for trouble — and a detected "hey vesper" starts a
// VesperAgent session via its imperative ref, same as tapping the orb.

'use client'
import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import VesperAgent, { type VesperAgentHandle } from '@/components/VesperAgent'

// AmbientListener touches `document` (createPortal) at render time, so it
// can't be prerendered on the server — load it client-only.
const AmbientListener = dynamic(() => import('@/components/AmbientListener'), { ssr: false })

export default function Home() {
  const [vesperActive, setVesperActive] = useState(false)
  const vesperRef = useRef<VesperAgentHandle>(null)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-4xl font-semibold tracking-tight text-white">Vesper</h1>
        <p className="text-sm text-neutral-400">Tap to talk, or say &ldquo;Hey Vesper&rdquo; while listening is on.</p>
      </div>

      <VesperAgent ref={vesperRef} onActiveChange={setVesperActive} />

      <AmbientListener paused={vesperActive} onWake={() => vesperRef.current?.start()} />
    </main>
  )
}
