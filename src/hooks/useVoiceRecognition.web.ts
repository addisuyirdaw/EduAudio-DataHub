/**
 * useVoiceRecognition.web.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Web Speech API implementation of the voice recognition hook.
 *
 * Replaces the native @react-native-voice/voice hook on web builds so the
 * AI Teacher push-to-talk flow works in the browser via SpeechRecognition
 * (Chrome/Edge/Safari/Android WebView). Gracefully degrades to a no-op with
 * a descriptive error when the browser does not expose SpeechRecognition.
 *
 * Behavior guarantees relied on by the AI Teacher FSM:
 * - `startListening` is idempotent (no-op while already listening).
 * - `onresult` captures both interim and final transcripts, so text keeps
 *   flowing even while the lesson document is initializing.
 * - `onend` / `onerror` auto-restart while `keepAlive` is true (debounced so
 *   Chrome doesn't throw InvalidStateError from a synchronous start()), so a
 *   held push-to-talk press survives transient recognition resets and the
 *   microphone never freezes.
 * - Auto-restarts keep the session callbacks: re-arming the recognizer via a
 *   `startListening()` call without options preserves the armed `onFinalResult`
 *   and `onLiveCommand` instead of clearing them.
 * - `startListening(options)` registers an `onFinalResult` callback used by
 *   the hands-free auto-listen loop; it is cleared again by `stopListening`.
 * - `stopListening` returns the latest recognized transcript.
 * - Live command keywords fire instantly the moment they are heard. Other
 *   (non-command) input passes a short mic-open echo grace, so a stuck
 *   `Speech.isSpeakingAsync()` (seen on some web browsers) can never block
 *   the mic — real student speech always gets through while the AI's own TTS
 *   output is still not re-routed as a phantom command.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import { playChime } from '../services/audioChime';

export interface UseVoiceRecognitionReturn {
  isListening: boolean;
  recognizedText: string;
  isRecognizing: boolean;
  error: string | null;

  startListening: (options?: StartListeningOptions) => Promise<void>;
  stopListening: () => Promise<string>;
  destroy: () => void;
  resetRecognizedText: () => void;
}

/**
 * Options for a single listening session. `onFinalResult` lets the auto-listen
 * loop (hands-free) process a recognized command without a push-to-talk press.
 * `onLiveCommand` fires the instant a navigation keyword is heard (interim or
 * final) so page transitions never wait for the speech session to end.
 */
export interface StartListeningOptions {
  onFinalResult?: (text: string) => void;
  onLiveCommand?: (command: LiveVoiceCommand, transcript: string) => void;
}

/**
 * Commands triggered instantly on live transcript keyword matches.
 * 'player' / 'teacher' are mode-switch requests handed to the top-level
 * mode bridge; 'greeting' routes the full sentence to the teacher engine
 * for a friendly spoken response; the rest are page-navigation commands.
 */
export type LiveVoiceCommand = 'next' | 'back' | 'repeat' | 'player' | 'teacher' | 'greeting' | 'pause' | 'start';

/**
 * Resolve an instant navigation keyword from the live transcript.
 * Word-boundary matching prevents false positives like "context" (contains
 * "next") or "feedback" (contains "back") from skipping pages.
 */
function resolveLiveCommand(cleanText: string): LiveVoiceCommand | null {
  if (/(?:^|\W)(?:next|continue|forward)(?:$|\W)/.test(cleanText)) return 'next';
  if (/(?:^|\W)(?:back|previous)(?:$|\W)/.test(cleanText)) return 'back';
  if (/(?:^|\W)(?:repeat|again)(?:$|\W)/.test(cleanText)) return 'repeat';
  // Instant interruption: "stop", "pause", "wait", "be quiet" cancel all
  // speech right away and move the teacher to a paused state.
  if (/(?:^|\W)(?:stop|pause|wait|be quiet|quiet)(?:$|\W)/.test(cleanText)) return 'pause';
  // Greetings are checked before mode words so "hi teacher" greets instead
  // of being swallowed by the (no-op) teacher mode-switch request.
  if (/(?:^|\W)(?:hello|hi|hey|good morning|good afternoon|good evening)(?:$|\W)/.test(cleanText)) return 'greeting';
  if (/(?:^|\W)(?:player)(?:$|\W)/.test(cleanText)) return 'player';
  if (/(?:^|\W)(?:teacher)(?:$|\W)/.test(cleanText)) return 'teacher';
  // Start/Teach: begin (or confirm) teaching the current page. Checked after
  // mode words so "start the player" still switches modes instead of teaching.
  if (/(?:^|\W)(?:start|teach|go ahead|begin)(?:$|\W)/.test(cleanText)) return 'start';
  return null;
}

/**
 * A transcript only counts as real speech when it carries actual words. The
 * browser recognizer can emit the UI hint ("Listening...") or pure silence /
 * punctuation; those must never be stored as `recognizedText` or fed to the
 * command matcher, otherwise the overlay gets stuck on a fake transcript.
 */
function isRealTranscript(text: string): boolean {
  const clean = text.toLowerCase().trim();
  if (!clean) return false;
  if (/^listening[.\s]*$/.test(clean)) return false;
  if (/^[\s.\-…]*$/.test(clean)) return false;
  return true;
}

/**
 * Minimal structural typing for the browser SpeechRecognition API.
 * Cast via `any` keeps us independent of lib.dom version differences.
 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  const SpeechRecognitionCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (typeof SpeechRecognitionCtor !== 'function') return null;
  return new SpeechRecognitionCtor();
}

const RESTART_DELAY_MS = 200;

/**
 * Short grace period after the mic opens during which non-command audio is
 * dropped in case the AI's own TTS is still audibly trailing off. Live
 * command keywords bypass this entirely, and the grace never depends on
 * `Speech.isSpeakingAsync()` (which some web browsers leave stuck at true).
 */
const MIC_OPEN_ECHO_GRACE_MS = 400;

/**
 * Hook for voice recognition functionality (web build).
 */
export function useVoiceRecognition(): UseVoiceRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const keepAliveRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const latestResultRef = useRef('');
  const finalResultRef = useRef<((text: string) => void) | null>(null);
  const liveCommandRef = useRef<((command: LiveVoiceCommand, transcript: string) => void) | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micOpenedAtRef = useRef(0);
  const ttsActiveAtMicOpenRef = useRef(false);

  const startListening = useCallback(async (options?: StartListeningOptions) => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }
    if (activeRef.current) return;

    // Auto-restart (from onend/onerror) and retry-after-start-failure call
    // startListening() without options. Preserve the session's callbacks in
    // that case — otherwise the first restart wipes the live-command handler
    // and every keyword heard afterwards is displayed but never routed.
    if (options) {
      finalResultRef.current = options.onFinalResult ?? null;
      liveCommandRef.current = options.onLiveCommand ?? null;
    }

    try {
      setError(null);
      setRecognizedText('');
      latestResultRef.current = '';
      stopRequestedRef.current = false;
      keepAliveRef.current = true;
      activeRef.current = true;
      setIsListening(true);
      setIsRecognizing(true);

      recognition.start();
      console.log('[VoiceRecognition.web] Started listening');
    } catch (startError) {
      activeRef.current = false;
      setIsListening(false);
      setIsRecognizing(false);
      setError(startError instanceof Error ? startError.message : 'Failed to start listening');
      console.error('[VoiceRecognition.web] Start listening error:', startError);
      // A transient start failure (e.g. restarting too quickly right after
      // onend) must not kill the session: retry while keepAlive is requested.
      if (keepAliveRef.current && !stopRequestedRef.current) {
        setTimeout(() => {
          if (keepAliveRef.current && !stopRequestedRef.current) {
            void startListening();
          }
        }, RESTART_DELAY_MS);
      }
    }
  }, []);

  /**
   * Some errors (missing mic permission, unsupported language) can never
   * succeed by retrying. Bailing out keeps the auto-listen loop from
   * hammering the recognizer forever when a browser blocks the mic.
   */
  const isFatalError = useCallback((error: string): boolean => {
    return (
      error === 'not-allowed' ||
      error === 'service-not-allowed' ||
      error === 'not-supported' ||
      error === 'audio-capture' ||
      error === 'bad-grammar'
    );
  }, []);

  const scheduleRestart = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (keepAliveRef.current && !stopRequestedRef.current) {
        console.log('[VoiceRecognition.web] Auto-restarting recognition after end/error');
        void startListening();
      }
    }, RESTART_DELAY_MS);
  }, [startListening]);

  // Setup speech recognition on mount
  useEffect(() => {
    const recognition = getRecognition();

    if (!recognition) {
      console.warn('[VoiceRecognition.web] SpeechRecognition is not supported in this browser.');
      setError('Speech recognition is not supported in this browser. You can still use the audio player.');
      return;
    }

    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsRecognizing(true);
      setError(null);
      console.log('[VoiceRecognition.web] Speech recognition started');
      // Mic is live: immediately silence any TTS output so the mic is never
      // blocked by audio the AI is currently reading aloud.
      try {
        Speech.stop();
      } catch {
        // ignore
      }
      // Record when the mic opened and whether TTS was still reported as
      // speaking at that instant. This only feeds the short echo grace below;
      // a stuck isSpeakingAsync() can never block commands past that grace.
      micOpenedAtRef.current = Date.now();
      void Speech.isSpeakingAsync()
        .then((speaking) => {
          ttsActiveAtMicOpenRef.current = speaking;
        })
        .catch(() => {
          ttsActiveAtMicOpenRef.current = false;
        });
      playChime('start');
    };

    recognition.onresult = (event: any) => {
      let transcript = '';
      let isFinal = false;
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result[0]?.transcript) {
          transcript = result[0].transcript;
          if (result.isFinal) isFinal = true;
        }
      }
      if (!transcript) return;

      // Placeholder guard: never show a fake "Listening..." hint.
      if (!isRealTranscript(transcript)) {
        setRecognizedText('');
        console.log(`[VoiceRecognition.web] Ignoring non-speech transcript "${transcript}"`);
        return;
      }

      const cleanText = transcript.toLowerCase().trim();

      // Immediate UI feedback: update the "Heard:" overlay in real time as
      // soon as the student speaks, before any async gating runs.
      setRecognizedText(cleanText);

      // Real-time keyword evaluation: live navigation keywords fire instantly
      // (no echo guard, no isSpeakingAsync dependence) so the page moves the
      // moment the student says the word.
      const liveCommand = resolveLiveCommand(cleanText);

      if (liveCommand && !stopRequestedRef.current) {
        // Consume the command now: prevent re-firing on later result events.
        stopRequestedRef.current = true;
        keepAliveRef.current = false;
        const handler = liveCommandRef.current;
        liveCommandRef.current = null;
        finalResultRef.current = null;
        // Clear the transcript immediately so the overlay never stays
        // stuck showing the consumed command while the page navigates.
        setRecognizedText('');

        console.log(
          `[VoiceRecognition.web] Live command matched: ${liveCommand} ("${cleanText}")`
        );
        if (handler) {
          void (async () => {
            const text = await stopListening();
            latestResultRef.current = '';
            handler(liveCommand, text || cleanText);
          })();
        } else {
          void stopListening();
        }
        return;
      }

      void (async () => {
        try {
          // Echo guard for non-command input: drop audio only in the short
          // window right after the mic opened (possible TTS echo), and only
          // if TTS was still reported as speaking then. This never blocks on
          // a stuck `Speech.isSpeakingAsync()` — once the grace elapses every
          // transcript is processed.
          if (
            ttsActiveAtMicOpenRef.current &&
            Date.now() - micOpenedAtRef.current < MIC_OPEN_ECHO_GRACE_MS
          ) {
            console.log(
              `[VoiceRecognition.web] Ignoring non-command transcript "${cleanText}" during mic-open echo grace`
            );
            return;
          }

          latestResultRef.current = cleanText;
          // Blind accessibility: expose the live transcript immediately.
          console.log('STT Captured:', cleanText);

          if (isFinal) {
            // Hands-free auto-listen loop: hand the recognized command
            // straight to the teacher engine without requiring a
            // push-to-talk release.
            finalResultRef.current?.(cleanText);
          }
        } catch (error) {
          console.error('[VoiceRecognition.web] Result processing error:', error);
        }
      })();
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      setIsRecognizing(false);
      activeRef.current = false;
      const errorCode = String(event?.error ?? 'unknown');
      setError(errorCode);
      console.error('[VoiceRecognition.web] Speech recognition error:', event);
      if (isFatalError(errorCode)) {
        keepAliveRef.current = false;
        stopRequestedRef.current = true;
      } else {
        scheduleRestart();
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setIsRecognizing(false);
      activeRef.current = false;
      console.log('[VoiceRecognition.web] Speech recognition ended');
      // Keep the microphone live: while a listening session is still active
      // (not a deliberate stop) restart the recognizer so the mic never
      // freezes between sessions. The restart is debounced because Chrome
      // throws InvalidStateError if start() is called synchronously from
      // inside onend.
      scheduleRestart();
    };

    return () => {
      keepAliveRef.current = false;
      stopRequestedRef.current = true;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try {
        recognition.abort();
      } catch {
        // ignore cleanup errors
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Stop listening for speech and return the latest recognized transcript.
   * Waits briefly so the final transcript event lands before resolving,
   * keeping the "stop then read recognizedText" flow in sync.
   */
  const stopListening = useCallback(async (): Promise<string> => {
    const recognition = recognitionRef.current;
    keepAliveRef.current = false;
    stopRequestedRef.current = true;
    finalResultRef.current = null;
    liveCommandRef.current = null;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    if (recognition) {
      try {
        recognition.stop();
      } catch (error) {
        console.warn('[VoiceRecognition.web] Stop listening error:', error);
      }
    }

    // The final onresult/onend events are delivered asynchronously after stop().
    const deadline = Date.now() + 1500;
    while (!latestResultRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const text = latestResultRef.current;
    setIsListening(false);
    setIsRecognizing(false);
    activeRef.current = false;
    setRecognizedText(text);
    console.log(`[VoiceRecognition.web] Stopped listening (result: "${text || '<empty>'}")`);
    playChime('end');
    return text;
  }, []);

  /**
   * Destroy voice recognition instance
   */
  const destroy = useCallback(() => {
    keepAliveRef.current = false;
    stopRequestedRef.current = true;
    finalResultRef.current = null;
    liveCommandRef.current = null;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    activeRef.current = false;
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setIsRecognizing(false);
    setRecognizedText('');
    setError(null);
  }, []);

  /**
   * Reset recognized text
   */
  const resetRecognizedText = useCallback(() => {
    latestResultRef.current = '';
    setRecognizedText('');
  }, []);

  return {
    isListening,
    recognizedText,
    isRecognizing,
    error,
    startListening,
    stopListening,
    destroy,
    resetRecognizedText,
  };
}
