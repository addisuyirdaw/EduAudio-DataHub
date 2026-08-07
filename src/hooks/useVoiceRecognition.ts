/**
 * useVoiceRecognition.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Voice Recognition Hook
 * 
 * Manages speech-to-text functionality using @react-native-voice/voice.
 * Handles microphone activation, speech recognition, and error handling.
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Voice from '@react-native-voice/voice';

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
 * Hook for voice recognition functionality
 */
export function useVoiceRecognition(): UseVoiceRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  const onSpeechStart = () => {
    setIsRecognizing(true);
    setError(null);
    console.log('[VoiceRecognition] Speech recognition started');
  };

  const onSpeechRecognized = () => {
    setIsRecognizing(false);
    console.log('[VoiceRecognition] Speech recognized');
  };

  const onSpeechEnd = () => {
    setIsListening(false);
    setIsRecognizing(false);
    console.log('[VoiceRecognition] Speech recognition ended');
  };

  const onSpeechError = (e: any) => {
    setIsListening(false);
    setIsRecognizing(false);
    setError(JSON.stringify(e.error));
    console.error('[VoiceRecognition] Speech recognition error:', e);
  };

  const onSpeechResults = (e: any) => {
    if (e.value && e.value.length > 0) {
      const text = e.value[0];
      setRecognizedText(text);
      console.log('[VoiceRecognition] Speech result:', text);
    }
  };

  const onSpeechPartialResults = (e: any) => {
    if (e.value && e.value.length > 0) {
      console.log('[VoiceRecognition] Partial result:', e.value[0]);
    }
  };

  const onSpeechVolumeChanged = (e: any) => {
    // Can be used for visual feedback
    // console.log('[VoiceRecognition] Volume changed:', e.value);
  };

  /**
   * Start listening for speech
   */
  const startListening = useCallback(async () => {
    try {
      setError(null);
      setRecognizedText('');
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
      setIsListening(false);
      setError(error instanceof Error ? error.message : 'Failed to start listening');
      console.error('[VoiceRecognition] Start listening error:', error);
    }
  }, []);

  /**
   * Stop listening for speech
   */
  const stopListening = useCallback(async () => {
    try {
      await Voice.stop();
      setIsListening(false);
      setIsRecognizing(false);
      console.log('[VoiceRecognition] Stopped listening');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to stop listening');
      console.error('[VoiceRecognition] Stop listening error:', error);
    }
  }, []);

  /**
   * Destroy voice recognition instance
   */
  const destroy = useCallback(() => {
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
