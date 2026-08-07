/**
 * useVoiceRecognition.web.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Web Speech API implementation of the voice recognition hook.
 *
 * Replaces the native @react-native-voice/voice hook on web builds so the
 * AI Teacher push-to-talk flow works in the browser via SpeechRecognition
 * (Chrome/Edge/Safari/Android WebView). Gracefully degrades to a no-op with
 * a descriptive error when the browser does not expose SpeechRecognition.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseVoiceRecognitionReturn {
  isListening: boolean;
  recognizedText: string;
  isRecognizing: boolean;
  error: string | null;

  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  destroy: () => void;
  resetRecognizedText: () => void;
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

/**
 * Hook for voice recognition functionality (web build).
 */
export function useVoiceRecognition(): UseVoiceRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Setup speech recognition on mount
  useEffect(() => {
    const recognition = getRecognition();

    if (!recognition) {
      console.warn('[VoiceRecognition.web] SpeechRecognition is not supported in this browser.');
      setError('Speech recognition is not supported in this browser. You can still use the audio player.');
      return;
    }

    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsRecognizing(true);
      setError(null);
      console.log('[VoiceRecognition.web] Speech recognition started');
    };

    recognition.onresult = (event: any) => {
      let finalText = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal && result[0]?.transcript) {
          finalText = result[0].transcript;
        }
      }
      if (finalText) {
        setRecognizedText(finalText);
        console.log('[VoiceRecognition.web] Speech result:', finalText);
      }
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      setIsRecognizing(false);
      setError(String(event?.error ?? 'Speech recognition error'));
      console.error('[VoiceRecognition.web] Speech recognition error:', event);
    };

    recognition.onend = () => {
      setIsListening(false);
      setIsRecognizing(false);
      console.log('[VoiceRecognition.web] Speech recognition ended');
    };

    return () => {
      try {
        recognition.abort();
      } catch {
        // ignore cleanup errors
      }
    };
  }, []);

  /**
   * Start listening for speech
   */
  const startListening = useCallback(async () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }

    setError(null);
    setRecognizedText('');
    setIsListening(true);
    setIsRecognizing(true);

    try {
      recognition.start();
      console.log('[VoiceRecognition.web] Started listening');
    } catch (error) {
      setIsListening(false);
      setIsRecognizing(false);
      setError(error instanceof Error ? error.message : 'Failed to start listening');
      console.error('[VoiceRecognition.web] Start listening error:', error);
    }
  }, []);

  /**
   * Stop listening for speech.
   * Waits briefly so the final transcript event lands before resolving,
   * keeping the native "stop then read recognizedText" flow in sync.
   */
  const stopListening = useCallback(async () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    try {
      recognition.stop();
    } catch (error) {
      console.warn('[VoiceRecognition.web] Stop listening error:', error);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    setIsListening(false);
    setIsRecognizing(false);
    console.log('[VoiceRecognition.web] Stopped listening');
  }, []);

  /**
   * Destroy voice recognition instance
   */
  const destroy = useCallback(() => {
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
