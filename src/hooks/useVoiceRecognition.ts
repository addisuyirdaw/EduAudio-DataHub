/**
 * useVoiceRecognition.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Voice Recognition Hook
 *
 * Manages speech-to-text functionality using @react-native-voice/voice.
 * Handles microphone activation, speech recognition, and error handling.
 *
 * Behavior guarantees relied on by the AI Teacher FSM:
 * - `startListening` is idempotent (no-op while already listening).
 * - While `keepAlive` is true the recognizer auto-restarts on end/error so a
 *   held push-to-talk press survives transient recognition resets.
 * - `startListening(options)` registers an `onFinalResult` callback used by
 *   the hands-free auto-listen loop; it is cleared again by `stopListening`.
 * - `stopListening` returns the latest recognized transcript (polled from the
 *   async onSpeechResults event that arrives after stop()).
 * - Every result is checked against `Speech.isSpeakingAsync()` and dropped
 *   while the AI is speaking out loud, so the AI's own TTS output can never
 *   be captured back into the mic and re-routed as a phantom command.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Voice from '@react-native-voice/voice';
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
 * recognizer can emit the UI hint ("Listening...") or pure silence /
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

const RESTART_DELAY_MS = 200;

/**
 * Hook for voice recognition functionality
 */
export function useVoiceRecognition(): UseVoiceRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef(false);
  const keepAliveRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const latestResultRef = useRef('');
  const finalResultRef = useRef<((text: string) => void) | null>(null);
  const liveCommandRef = useRef<((command: LiveVoiceCommand, transcript: string) => void) | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startListening = useCallback(async (options?: StartListeningOptions) => {
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

      await Voice.start('en-US', {
        EXTRA_PARTIAL_RESULTS: true,
        EXTRA_MAX_ALTERNATIVES: 3,
        EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 1000,
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2000,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1500,
      });

      console.log('[VoiceRecognition] Started listening');
    } catch (error) {
      activeRef.current = false;
      setIsListening(false);
      setError(error instanceof Error ? error.message : 'Failed to start listening');
      console.error('[VoiceRecognition] Start listening error:', error);
    }
  }, []);

  const isFatalError = useCallback((error: string): boolean => {
    return (
      error === 'not-allowed' ||
      error === 'service-not-allowed' ||
      error === 'not-supported' ||
      error === 'audio-capture' ||
      error === 'bad-grammar' ||
      error === 'LanguageNotSupported'
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
        console.log('[VoiceRecognition] Auto-restarting recognition after end/error');
        void startListening();
      }
    }, RESTART_DELAY_MS);
  }, [startListening]);

  const onSpeechStart = () => {
    setIsRecognizing(true);
    setError(null);
    console.log('[VoiceRecognition] Speech recognition started');
    // Mic is live: silence any TTS output so the mic is never blocked.
    try {
      Speech.stop();
    } catch {
      // ignore
    }
    playChime('start');
  };

  const onSpeechRecognized = () => {
    setIsRecognizing(false);
    console.log('[VoiceRecognition] Speech recognized');
  };

  const onSpeechEnd = () => {
    setIsListening(false);
    setIsRecognizing(false);
    activeRef.current = false;
    console.log('[VoiceRecognition] Speech recognition ended');
    scheduleRestart();
  };

  const onSpeechError = (e: any) => {
    setIsListening(false);
    setIsRecognizing(false);
    activeRef.current = false;
    const raw = typeof e?.error === 'string' ? e.error : JSON.stringify(e?.error ?? e);
    setError(raw);
    console.error('[VoiceRecognition] Speech recognition error:', e);
    if (isFatalError(raw)) {
      keepAliveRef.current = false;
      stopRequestedRef.current = true;
    } else {
      scheduleRestart();
    }
  };

  const onSpeechResults = (e: any) => {
    if (e.value && e.value.length > 0) {
      const text = e.value[0];
      void (async () => {
        try {
          // Echo guard: if the AI is speaking out loud right now, this audio
          // is its own voice echoing back into the mic. Drop it.
          if (await Speech.isSpeakingAsync()) {
            console.log(`[VoiceRecognition] Ignoring "${text}" while TTS is active`);
            return;
          }

          // Placeholder guard: never store a fake "Listening..." hint as the
          // recognized transcript and never feed it to the command matcher.
          if (!isRealTranscript(text)) {
            setRecognizedText('');
            console.log(`[VoiceRecognition] Ignoring non-speech transcript "${text}"`);
            return;
          }

          latestResultRef.current = text;
          setRecognizedText(text);
          console.log('STT Captured:', text);

          // Real-time keyword evaluation on final results (see onSpeechPartialResults
          // for interim). Navigation never waits for the session to end.
          const cleanText = text.toLowerCase().trim();
          const liveCommand = resolveLiveCommand(cleanText);
          if (liveCommand && !stopRequestedRef.current) {
            stopRequestedRef.current = true;
            keepAliveRef.current = false;
            const handler = liveCommandRef.current;
            liveCommandRef.current = null;
            finalResultRef.current = null;
            // Clear the transcript immediately so the overlay never stays
            // stuck showing the consumed command while the page navigates.
            setRecognizedText('');
            console.log(`[VoiceRecognition] Live command matched: ${liveCommand} ("${cleanText}")`);
            if (handler) {
              void (async () => {
                const captured = await stopListening();
                latestResultRef.current = '';
                handler(liveCommand, captured || text);
              })();
            } else {
              void stopListening();
            }
            return;
          }

          // Hands-free auto-listen loop: hand the recognized command to the
          // teacher engine without requiring a push-to-talk release.
          finalResultRef.current?.(text);
        } catch (error) {
          console.error('[VoiceRecognition] Result processing error:', error);
        }
      })();
    }
  };

  const onSpeechPartialResults = (e: any) => {
    if (e.value && e.value.length > 0) {
      console.log('[VoiceRecognition] Partial result:', e.value[0]);

      const partialText = e.value[0];
      void (async () => {
        try {
          // Echo guard: ignore interim results captured while the AI's own
          // TTS is playing out loud.
          if (await Speech.isSpeakingAsync()) {
            return;
          }
          // Placeholder guard: never feed a fake "Listening..." hint to the
          // command matcher.
          if (!isRealTranscript(partialText)) {
            setRecognizedText('');
            console.log(`[VoiceRecognition] Ignoring non-speech partial "${partialText}"`);
            return;
          }
          // Real-time keyword evaluation on interim results: act the moment a
          // navigation keyword appears, before the speech session ends.
          const cleanText = partialText.toLowerCase().trim();
          const liveCommand = resolveLiveCommand(cleanText);
          if (liveCommand && !stopRequestedRef.current) {
            stopRequestedRef.current = true;
            keepAliveRef.current = false;
            const handler = liveCommandRef.current;
            liveCommandRef.current = null;
            finalResultRef.current = null;
            // Clear the transcript immediately so the overlay never stays
            // stuck showing the consumed command while the page navigates.
            setRecognizedText('');
            console.log(`[VoiceRecognition] Live command matched: ${liveCommand} ("${cleanText}")`);
            if (handler) {
              void (async () => {
                const captured = await stopListening();
                latestResultRef.current = '';
                handler(liveCommand, captured || partialText);
              })();
            } else {
              void stopListening();
            }
          }
        } catch (error) {
          console.error('[VoiceRecognition] Partial result processing error:', error);
        }
      })();
    }
  };

  const onSpeechVolumeChanged = (e: any) => {
    // Can be used for visual feedback
    // console.log('[VoiceRecognition] Volume changed:', e.value);
  };

  // Setup voice recognition on mount
  useEffect(() => {
    Voice.onSpeechStart = onSpeechStart;
    Voice.onSpeechRecognized = onSpeechRecognized;
    Voice.onSpeechEnd = onSpeechEnd;
    Voice.onSpeechError = onSpeechError;
    Voice.onSpeechResults = onSpeechResults;
    Voice.onSpeechPartialResults = onSpeechPartialResults;
    Voice.onSpeechVolumeChanged = onSpeechVolumeChanged;

    return () => {
      keepAliveRef.current = false;
      stopRequestedRef.current = true;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      Voice.destroy().then(Voice.removeAllListeners);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Stop listening for speech and return the latest recognized transcript.
   * Pauses briefly so the async onSpeechResults event can land before we
   * resolve, keeping the "stop then read recognizedText" flow in sync.
   */
  const stopListening = useCallback(async (): Promise<string> => {
    keepAliveRef.current = false;
    stopRequestedRef.current = true;
    finalResultRef.current = null;
    liveCommandRef.current = null;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    try {
      await Voice.stop();
    } catch (error) {
      console.warn('[VoiceRecognition] Stop listening error:', error);
    }

    setIsListening(false);
    setIsRecognizing(false);
    activeRef.current = false;

    // The final onSpeechResults event is delivered asynchronously after stop().
    const deadline = Date.now() + 1500;
    while (!latestResultRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const text = latestResultRef.current;
    setRecognizedText(text);
    console.log(`[VoiceRecognition] Stopped listening (result: "${text || '<empty>'}")`);
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
    Voice.destroy().then(Voice.removeAllListeners);
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
