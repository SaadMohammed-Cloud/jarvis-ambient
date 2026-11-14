// app/page.tsx
//
// Vesper's home page. Minimal on purpose — just the title and the
// Listening mode toggle. Everything else (the actual conversational
// voice layer, via ElevenLabs) comes later.

'use client'
import dynamic from 'next/dynamic'

// AmbientListener touches `document` (createPortal) at render time, so it
// can't be prerendered on the server — load it client-only.
const AmbientListener = dynamic(() => import('@/components/AmbientListener'), { ssr: false })

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-semibold tracking-tight text-white">Vesper</h1>
      <p className="text-sm text-neutral-400">Say &ldquo;Hey Vesper&rdquo; to talk.</p>
      <AmbientListener
        paused={false}
        onWake={() => {
          // No conversational layer wired up yet — ElevenLabs goes here.
        }}
      />
    </main>
  )
}
