/**
 * useAccessibilityAudio.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Custom hook that encapsulates all audio-playback state and the accessibility
 * live-region status messages for the Educational Audio Player.
 *
 * HOW LIVE REGIONS WORK IN REACT NATIVE
 * ───────────────────────────────────────
 * When `accessibilityLiveRegion="polite"` is set on a <View>, the native
 * accessibility runtime (VoiceOver on iOS, TalkBack on Android) monitors that
 * subtree for text changes. When `statusMessage` is updated, the screen reader
 * automatically reads the new text WITHOUT the user having to navigate to it.
 * This is the React Native equivalent of ARIA live regions on the web.
 *
 * STATE MACHINE
 * ─────────────────────────────────────────────────────────────────────────────
 *  idle ──[load]──► ready ──[play]──► playing
 *   ▲                                    │
 *   │                   ◄──[pause]───────┘
 *   └──[unload]─── paused
 *
 * AI overlay is independent of audio state:
 *  aiIdle ──[toggle]──► aiListening ──[toggle]──► aiIdle
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio, AVPlaybackStatus } from 'expo-av';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AudioPlayerState {
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Whether the sound asset is still loading */
  isLoading: boolean;
  /** Current playback position in milliseconds */
  positionMs: number;
  /** Total duration in milliseconds (0 until loaded) */
  durationMs: number;
  /** Whether the AI voice overlay is active */
  isAIListening: boolean;
  /**
   * Human-readable status announcement.
   * This string is placed inside a View with `accessibilityLiveRegion="polite"`
   * so that screen readers automatically read it when it changes.
   */
  statusMessage: string;
}

export interface AudioPlayerActions {
  /** Toggle between play and pause */
  togglePlayPause: () => Promise<void>;
  /** Seek backward 15 seconds */
  skipBackward15: () => Promise<void>;
  /** Seek forward 15 seconds */
  skipForward15: () => Promise<void>;
  /** Toggle the AI voice command overlay */
  toggleAI: () => void;
  /** Seek to an arbitrary position (ms) — used by the progress bar */
  seekTo: (positionMs: number) => Promise<void>;
}

export type UseAccessibilityAudioReturn = AudioPlayerState & AudioPlayerActions;

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Demo audio: a publicly available royalty-free lecture recording.
 * Replace this URI with your actual course audio asset.
 */
const DEMO_AUDIO_URI =
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

const SKIP_INTERVAL_MS = 15_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAccessibilityAudio(): UseAccessibilityAudioReturn {
  const soundRef = useRef<Audio.Sound | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isAIListening, setIsAIListening] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Loading audio…');

  // ── Audio Setup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;

    /**
     * Configure the audio session before creating the Sound object.
     * `INTERRUPTION_MODE_IOS_DO_NOT_MIX` ensures the audio pauses other apps
     * (expected behaviour for a lecture player).
     */
    async function setupAudio() {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,          // play even when iOS silent switch is on
        staysActiveInBackground: true,        // continue playback with screen off
        shouldDuckAndroid: true,              // duck other audio on Android
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: DEMO_AUDIO_URI },
        { shouldPlay: false },
        (status: AVPlaybackStatus) => {
          // This callback is fired by expo-av on every playback status update.
          if (!mounted) return;
          if (!status.isLoaded) {
            if (status.error) {
              setStatusMessage(`Playback error: ${status.error}`);
            }
            return;
          }

          setIsPlaying(status.isPlaying);
          setPositionMs(status.positionMillis ?? 0);
          setDurationMs(status.durationMillis ?? 0);

          if (status.didJustFinish) {
            setIsPlaying(false);
            setStatusMessage('Lecture finished');
          }
        }
      );

      if (!mounted) {
        await sound.unloadAsync();
        return;
      }

      soundRef.current = sound;
      setIsLoading(false);
      setStatusMessage('Audio ready. Press Play to begin the lecture.');
    }

    setupAudio().catch((err) => {
      console.error('[useAccessibilityAudio] setup error:', err);
      setStatusMessage('Failed to load audio. Please try again.');
    });

    return () => {
      mounted = false;
      soundRef.current?.unloadAsync();
    };
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  /**
   * togglePlayPause
   * Updates the live-region message so VoiceOver / TalkBack announces the
   * new state without the user needing to navigate to the button again.
   */
  const togglePlayPause = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return;

    if (status.isPlaying) {
      await sound.pauseAsync();
      // 'polite' live region will read this automatically
      setStatusMessage('Audio Paused');
    } else {
      await sound.playAsync();
      setStatusMessage('Audio Playing');
    }
  }, []);

  /**
   * skipBackward15
   * Clamps to 0 to prevent negative seek positions.
   */
  const skipBackward15 = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return;

    const newPosition = Math.max(0, (status.positionMillis ?? 0) - SKIP_INTERVAL_MS);
    await sound.setPositionAsync(newPosition);
    setStatusMessage('Skipped back 15 seconds');
  }, []);

  /**
   * skipForward15
   * Clamps to (duration - 1 s) to avoid seeking past the end.
   */
  const skipForward15 = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return;

    const duration = status.durationMillis ?? 0;
    const newPosition = Math.min(
      duration > 0 ? duration - 1000 : 0,
      (status.positionMillis ?? 0) + SKIP_INTERVAL_MS
    );
    await sound.setPositionAsync(newPosition);
    setStatusMessage('Skipped forward 15 seconds');
  }, []);

  /**
   * seekTo
   * Used by the progress scrubber.
   */
  const seekTo = useCallback(async (ms: number) => {
    const sound = soundRef.current;
    if (!sound) return;
    await sound.setPositionAsync(ms);
  }, []);

  /**
   * toggleAI
   * Activates / deactivates the voice-command overlay.
   * The live-region announces the transition so users know when to speak.
   */
  const toggleAI = useCallback(() => {
    setIsAIListening((prev) => {
      const next = !prev;
      setStatusMessage(
        next
          ? 'AI Listening — speak your question now'
          : 'AI Ready. Tap Ask AI to ask another question.'
      );
      return next;
    });
  }, []);

  // ── Return ───────────────────────────────────────────────────────────────────

  return {
    isPlaying,
    isLoading,
    positionMs,
    durationMs,
    isAIListening,
    statusMessage,
    togglePlayPause,
    skipBackward15,
    skipForward15,
    seekTo,
    toggleAI,
  };
}
