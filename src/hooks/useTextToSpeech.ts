/**
 * useTextToSpeech.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Text-to-Speech Hook
 * 
 * Manages TTS functionality using expo-speech.
 * Handles speech synthesis, voice selection, rate control, and coordination
 * with the audio mutex to prevent conflicts with screen readers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import { AccessibilityInfo } from 'react-native';
import { audioMutex } from '../context/AudioMutex';

export interface UseTextToSpeechReturn {
  isSpeaking: boolean;
  availableVoices: Speech.Voice[];
  selectedVoice: string;
  speechRate: number;
  
  speak: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setVoice: (voice: string) => void;
  setRate: (rate: number) => void;
  getAvailableVoices: () => Promise<void>;
}

/**
 * Hook for text-to-speech functionality
 */
export function useTextToSpeech(): UseTextToSpeechReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<Speech.Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [speechRate, setSpeechRate] = useState(1.0);

  const isScreenReaderEnabledRef = useRef(false);

  // Check screen reader status on mount
  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      isScreenReaderEnabledRef.current = enabled;
      console.log('[TTS] Screen reader enabled:', enabled);
    });

    // Load available voices
    getAvailableVoices();

    // Setup speaking status listener
    const speakingListener = Speech.speak('', {
      onDone: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
    });

    return () => {
      // Cleanup
    };
  }, []);

  /**
   * Get available voices for the device
   */
  const getAvailableVoices = useCallback(async () => {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      setAvailableVoices(voices);
      
      // Select a default English voice
      const defaultVoice = voices.find(
        (voice) => voice.language === 'en-US' || voice.language === 'en-GB'
      );
      if (defaultVoice) {
        setSelectedVoice(defaultVoice.identifier);
      }
      
      console.log('[TTS] Available voices:', voices.length);
    } catch (error) {
      console.error('[TTS] Failed to get voices:', error);
    }
  }, []);

  /**
   * Speak text with TTS
   * Coordinates with audio mutex and checks screen reader status
   */
  const speak = useCallback(async (text: string) => {
    if (!text || text.trim().length === 0) {
      console.warn('[TTS] Empty text provided');
      return;
    }

    try {
      // If screen reader is enabled, use AccessibilityInfo instead
      if (isScreenReaderEnabledRef.current) {
        console.log('[TTS] Screen reader active, using AccessibilityInfo');
        AccessibilityInfo.announceForAccessibility(text);
        setIsSpeaking(true);
        setTimeout(() => setIsSpeaking(false), 2000); // Approximate duration
        return;
      }

      // Acquire TTS lock from audio mutex
      await audioMutex.acquireTTSLock();

      setIsSpeaking(true);
      console.log('[TTS] Speaking:', text.substring(0, 50) + '...');

      await Speech.speak(text, {
        voice: selectedVoice || undefined,
        rate: speechRate,
        pitch: 1.0,
        onDone: () => {
          setIsSpeaking(false);
          audioMutex.releaseTTSLock();
        },
        onError: (error) => {
          console.error('[TTS] Speech error:', error);
          setIsSpeaking(false);
          audioMutex.releaseTTSLock();
        },
        onStopped: () => {
          setIsSpeaking(false);
          audioMutex.releaseTTSLock();
        },
      });
    } catch (error) {
      console.error('[TTS] Speak error:', error);
      setIsSpeaking(false);
      await audioMutex.releaseTTSLock();
    }
  }, [selectedVoice, speechRate]);

  /**
   * Stop current speech
   */
  const stop = useCallback(async () => {
    try {
      await Speech.stop();
      setIsSpeaking(false);
      await audioMutex.releaseTTSLock();
      console.log('[TTS] Stopped');
    } catch (error) {
      console.error('[TTS] Stop error:', error);
    }
  }, []);

  /**
   * Pause current speech
   */
  const pause = useCallback(async () => {
    try {
      await Speech.pause();
      console.log('[TTS] Paused');
    } catch (error) {
      console.error('[TTS] Pause error:', error);
    }
  }, []);

  /**
   * Resume paused speech
   */
  const resume = useCallback(async () => {
    try {
      await Speech.resume();
      console.log('[TTS] Resumed');
    } catch (error) {
      console.error('[TTS] Resume error:', error);
    }
  }, []);

  /**
   * Set the voice for speech synthesis
   */
  const setVoice = useCallback((voice: string) => {
    setSelectedVoice(voice);
    console.log('[TTS] Voice set to:', voice);
  }, []);

  /**
   * Set the speech rate
   * Range: 0.5 (slow) to 2.0 (fast)
   */
  const setRate = useCallback((rate: number) => {
    const clampedRate = Math.max(0.5, Math.min(2.0, rate));
    setSpeechRate(clampedRate);
    console.log('[TTS] Rate set to:', clampedRate);
  }, []);

  return {
    isSpeaking,
    availableVoices,
    selectedVoice,
    speechRate,
    speak,
    stop,
    pause,
    resume,
    setVoice,
    setRate,
    getAvailableVoices,
  };
}
