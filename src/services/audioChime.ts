/**
 * audioChime.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Web Audio API chime/beep utility for blind accessibility feedback.
 *
 * Plays a short two-tone beep when push-to-talk listening starts and ends so
 * visually impaired users get instant, non-visual confirmation that the
 * microphone is active. Uses a lazy singleton AudioContext and gracefully
 * no-ops on native builds / browsers without Web Audio support.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type ChimeKind = 'start' | 'end';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  const Ctor: (typeof AudioContext) | undefined = w.AudioContext ?? w.webkitAudioContext;
  if (typeof Ctor !== 'function') return null;

  if (!audioContext) {
    audioContext = new Ctor();
  }
  // Browsers suspend the context until a user gesture; resume is fire-and-forget.
  if (audioContext.state === 'suspended') {
    void audioContext.resume();
  }
  return audioContext;
}

function tone(
  ctx: AudioContext,
  startAt: number,
  frequency: number,
  duration: number,
  type: OscillatorType = 'triangle'
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.05);
}

/**
 * Play a push-to-talk feedback chime.
 * - 'start': rising tone (mic open)
 * - 'end':   falling tone (mic closed)
 */
export function playChime(kind: ChimeKind): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime + 0.02;
  if (kind === 'start') {
    tone(ctx, now, 523.25, 0.15);
    tone(ctx, now + 0.12, 783.99, 0.2);
  } else {
    tone(ctx, now, 783.99, 0.15);
    tone(ctx, now + 0.12, 523.25, 0.25);
  }
}
