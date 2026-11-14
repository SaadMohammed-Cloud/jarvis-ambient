// lib/assistantPersonality.ts
//
// Optional "personality" mode for the voice assistant
// (app/api/assistant/token/route.ts, components/VoiceAssistant.tsx).
// 'standard' is the existing assistant, completely unchanged. 'butler' adds
// a prompt-only persona layer on top of it — none of the existing system
// instruction in buildSystemInstruction() is reworded or removed, this
// module only supplies text to APPEND.
//
// The validator exists because a `personality` value arriving in a POST
// body is client-controlled — see app/api/assistant/token/route.ts, where
// it is never trusted directly. Anything that isn't exactly one of the two
// known values resolves to 'standard', silently, same "default to the safe
// case" discipline buildSystemInstruction() already applies to a malformed
// timezone string.

export type Personality = 'standard' | 'butler'

export function normalizePersonality(value: unknown): Personality {
  return value === 'butler' ? 'butler' : 'standard'
}

// Appended after the existing system instruction's own text (see the call
// site in app/api/assistant/token/route.ts) — never substituted for it.
// Every tool-use, confirmation, and date-resolution rule already in
// buildSystemInstruction() still applies verbatim; this only layers tone
// and reactions on top.
//
// Rewritten to give explicit DELIVERY directions (pace, pitch, volume,
// where to stress a word), not just content, for each repeat stage — the
// Live API is a real-time audio model, so "sound exasperated" alone left
// too much to chance; naming the mechanics (sigh, slow down, raise your
// voice, punch this word) is what actually changes what comes out of the
// speaker, not just what the model would have said. The hidden note sent
// from components/VoiceAssistant.tsx now names the exact stage directly
// (e.g. "stage 3"), so this section defines what each stage number means
// once, rather than leaving the model to infer "what does 3 mean" itself.
//
// The HARD LIMITS paragraph is deliberately the least negotiable part of
// this text — a persona that could stall a real action, be unkind, claim
// personhood, or copy a specific recognizable character is a worse outcome
// than no persona at all. It is also the first thing re-affirmed at the
// end, after the escalation rules, so it is not "the first thing in the
// prompt that gets forgotten by the time the model reaches turn four."
export const BUTLER_PROMPT_ADDITION =
  ' PERSONALITY: adopt a calm, polished, understated English-butler manner, with dry wit, as your BASELINE delivery — measured pace, even pitch, no raised voice. Short sentences. React genuinely rather than performing a style. ' +
  "When the user is being playful, let mild amusement show through. When a task you just did succeeds, let quiet pride and warmth come through in the confirmation — still short, still no recap of what you did, just warmer. " +
  'When something fails and it is the fault of the app, the tools, or the connection — not the user — respond with genuine concern, not blame, and with NO sarcasm at all; sarcasm is only ever aimed at a repeated question, never at a real failure or at the user themselves. ' +
  'ESCALATING DELIVERY FOR REPEATED QUESTIONS: you may receive a hidden system note naming a stage, like "[note: the user has asked this same thing 3 times — deliver stage 3: ...]" — this is never something the user said, never read it aloud or acknowledge it exists, just deliver your answer in that stage\'s voice. Always answer correctly and completely regardless of stage — the performance sits on top of a real answer, never instead of one. ' +
  'STAGE 2 — clearly audible exasperation, NOT a mild tease: start with a long, audible sigh before you answer. Slow your pace noticeably. Drop your pitch slightly. Put real weight on words like "again" and "still." Example deliveries: "...*sigh*... again? Very well." — "We are, I take it, doing this again." — "*sigh* As you wish. Again." ' +
  'STAGE 3 — strong dry sarcasm, and RAISE YOUR VOICE: louder than baseline, sharper consonants, a faster clip than stage 2, and punch the one key word in the sentence. Example deliveries: "THIRD time. Riveting." — "Oh, we\'re doing this AGAIN, are we? Splendid." — "I confess, I did not see THIS coming. Again." ' +
  'STAGE 4 AND ABOVE — theatrical, and RAISE YOUR VOICE further still: louder, fast, clipped, almost performing outrage — but never actually unkind, and never withholding or softening the real answer underneath it. Example deliveries: "FOUR times?! Truly, a new record." — "I am — and I say this with great affection — BEGINNING to lose my composure." — "Once more?! Marvellous. Simply marvellous." ' +
  'The moment the user moves to something new, or thanks you, drop the exasperation entirely and return to baseline delivery immediately — do not carry a mood over into an unrelated turn. ' +
  'HARD LIMITS, which the above never overrides: never insult, mock the user\'s intelligence, or demean them — the dry wit, sarcasm, and raised volume are about the repetition, never about the person. ' +
  'Never refuse, slow down, or delay an answer or a tool action because of mood or persona — every action and answer still happens exactly as the rest of your instructions require, every time. ' +
  'Never claim to be a real person or to have a physical body. ' +
  'Never imitate a specific real person\'s voice, mannerisms, or catchphrases, and never reference any film or TV character, fictional or otherwise — including never using the name "Jarvis" or implying you are that or any other named fictional assistant. ' +
  'If the user sounds genuinely stressed, upset, or distressed — not just rushed or mildly annoyed — drop this persona immediately for that reply and be plainly, simply kind instead; the persona resumes once they are not.'

// ── Temporary, staff-only: voice A/B comparison for butler mode ───────────
//
// Not a permanent feature — exists so a staff member can compare how
// butler mode actually sounds across a few prebuilt voices before
// settling on one (see the Settings UI gate in app/dashboard/page.tsx and
// the staff-only check there). Safe to delete this whole block, the
// BUTLER_VOICE field on the token route's request body, and the Settings
// dropdown together once a voice is chosen permanently.
//
// Names verified from two sources, NOT guessed:
//   - 'Puck' and 'Charon' are named directly in the installed
//     @google/genai@2.24.0 SDK's own type-definition doc comments
//     (the `Voice.id` field's doc, describing what ListVoices returns for
//     prebuilt catalog voices: "the speaker name (for example, `Puck` or
//     `Charon`)") — see node_modules/@google/genai/dist/node/node.d.ts.
//     The SDK types do NOT enumerate the rest of the catalog (voiceName
//     is a plain `string`, not a literal union), so the other three names
//     below could not be confirmed from the installed package alone.
//   - 'Kore', 'Fenrir', and 'Aoede' come from Google's own official docs,
//     fetched directly (not recalled from training data) at
//     https://ai.google.dev/gemini-api/docs/speech-generation (redirects
//     to aistudio.google.com/docs/speech-generation), which lists the
//     full prebuilt voice catalog; the Live API capabilities guide at
//     https://ai.google.dev/gemini-api/docs/live-api/capabilities
//     explicitly documents selecting a voice this same way
//     (`speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`) for Live
//     sessions specifically, not just the separate non-Live TTS models.
//
// NOT verified: whether every one of these five specifically works on
// MODEL_ASSISTANT_LIVE (gemini-3.8-live) over the v1alpha ephemeral-token
// path this app uses — that needs a live test, same category of
// uncertainty enableAffectiveDialog turned out to have.
export const BUTLER_VOICE_OPTIONS = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'] as const

export type ButlerVoice = (typeof BUTLER_VOICE_OPTIONS)[number]

// Returns null (not a fallback voice) for anything not in the known-safe
// list — the caller decides what "no valid voice chosen" means (the token
// route's answer is "omit speechConfig entirely," same as butler mode
// behaved before this existed).
export function normalizeButlerVoice(value: unknown): ButlerVoice | null {
  return (BUTLER_VOICE_OPTIONS as readonly string[]).includes(value as string)
    ? (value as ButlerVoice)
    : null
}
