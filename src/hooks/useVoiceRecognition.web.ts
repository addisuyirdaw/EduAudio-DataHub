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
 * - `onerror` / `onend` auto-restart while `keepAlive` is true so a held
 *   push-to-talk press survives transient recognition resets.
 * - `startListening(options)` registers an `onFinalResult` callback used by
 *   the hands-free auto-listen loop; it is cleared again by `stopListening`.
 * - `stopListening` returns the latest recognized transcript.
 * - Every result is checked against `Speech.isSpeakingAsync()` and dropped
 *   while the AI is speaking out loud, so the AI's own TTS output can never
 *   be captured back into the mic and re-routed as a phantom command.
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
export type LiveVoiceCommand = 'next' | 'back' | 'repeat' | 'player' | 'teacher' | 'greeting' | 'pause';

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

  const startListening = useCallback(async (options?: StartListeningOptions) => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }
    if (activeRef.current) return;

    finalResultRef.current = options?.onFinalResult ?? null;
    liveCommandRef.current = options?.onLiveCommand ?? null;

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

      void (async () => {
        try {
          // Echo guard: if the AI is speaking out loud right now, this audio
          // is almost certainly its own voice echoing back into the mic. Drop
          // it — the AI's TTS must never be captured as a phantom command.
          if (await Speech.isSpeakingAsync()) {
            console.log(`[VoiceRecognition.web] Ignoring "${transcript}" while TTS is active`);
            return;
          }

          // Placeholder guard: never store a fake "Listening..." hint as the
          // recognized transcript and never feed it to the command matcher.
          if (!isRealTranscript(transcript)) {
            setRecognizedText('');
            console.log(`[VoiceRecognition.web] Ignoring non-speech transcript "${transcript}"`);
            return;
          }

          latestResultRef.current = transcript;
          setRecognizedText(transcript);
          // Blind accessibility: expose the live transcript immediately.
          console.log('STT Captured:', transcript);

          // Real-time keyword evaluation: test the live transcript on every
          // speech event (interim AND final) so page navigation doesn't wait
          // for the speech session to end.
          const cleanText = transcript.toLowerCase().trim();
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
                handler(liveCommand, text || transcript);
              })();
            } else {
              void stopListening();
            }
            return;
          }

          if (isFinal) {
            // Hands-free auto-listen loop: hand the recognized command
            // straight to the teacher engine without requiring a
            // push-to-talk release.
            finalResultRef.current?.(transcript);
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
