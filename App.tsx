/**
 * App.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point for the Accessible Educational Audio Player.
 * Wraps the player in a SafeAreaView so content is never obscured by the
 * device notch, home indicator, or status bar.
 *
 * AUDIO CONFIGURATION
 * Configures expo-av audio mode to support simultaneous hardware capture
 * and background playback for AI Teacher Mode.
 *
 * MODE SWITCHER
 * Switches between the Audio Player and the AI Teacher screen. Exposes both
 * experiences on every platform (iOS, Android, and the static web export).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView, StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { EducationalAudioPlayer } from './src/components/EducationalAudioPlayer';
import { AITeacherScreen } from './src/components/AITeacherScreen';
import { useKeyboardPTT, isEditableTarget } from './src/hooks/useKeyboardPTT';
import { audioMutex } from './src/context/AudioMutex';
import { modeBridge } from './src/services/modeBridge';
import { Colors, Typography, Spacing, Radius } from './src/styles/theme';

type Mode = 'player' | 'teacher';

export default function App() {
  const [mode, setMode] = useState<Mode>('player');
  // Ref mirror of `mode` so async callbacks (mode bridge, hotkeys) can read
  // the latest value without re-subscribing on every change.
  const modeRef = useRef<Mode>('player');

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    // Configure audio mode for AI Teacher Mode
    // This enables simultaneous recording and playback with proper ducking
    async function configureAudio() {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        console.log('[App] Audio mode configured successfully');
      } catch (error) {
        console.error('[App] Audio mode configuration failed:', error);
      }
    }

    configureAudio();
  }, []);

  /**
   * Spoken confirmation of a mode change: "Switched to [Audio Player / AI
   * Teacher]. How can I help?" Resolves only when the announcement finishes
   * speaking (or is interrupted / errors), so callers can order the screen
   * swap relative to the speech.
   */
  const announceMode = useCallback(async (nextMode: Mode): Promise<void> => {
    const label = nextMode === 'player' ? 'Audio Player' : 'AI Teacher';
    await Speech.stop();
    await new Promise<void>((resolve) => {
      let settled = false;
      let safety: ReturnType<typeof setTimeout>;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        resolve();
      };
      safety = setTimeout(() => {
        console.warn('[App] Mode announcement timed out.');
        settle();
      }, 10000);
      try {
        Speech.speak(`Switched to ${label}. How can I help?`, {
          language: 'en-US',
          rate: 0.95,
          onDone: settle,
          onStopped: settle,
          onError: () => {
            console.warn('[App] Mode announcement error.');
            settle();
          },
        });
      } catch (error) {
        console.warn('[App] Mode announcement failed:', error);
        settle();
      }
    });
  }, []);

  /**
   * Audio isolation on tab switch: stop any in-flight TTS / mutex-tracked
   * playback before the screen swap, then announce the new mode out loud.
   * When entering the AI Teacher - which mounts silently and immediately opens
   * the mic, whose start handler silences TTS - the confirmation is spoken
   * BEFORE the swap so the mic never cuts it off. The Audio Player has no mic,
   * so its announcement can safely play after the swap.
   */
  const switchMode = useCallback(async (nextMode: Mode): Promise<void> => {
    if (modeRef.current === nextMode) return;
    await audioMutex.hardPause();
    if (nextMode === 'teacher') {
      await announceMode(nextMode);
    }
    modeRef.current = nextMode;
    setMode(nextMode);
    if (nextMode === 'player') {
      void announceMode(nextMode);
    }
  }, [announceMode]);

  // 'T' hotkey toggles between Audio Player and AI Teacher (web builds) for
  // keyboard and screen-reader users. Guarded against editable targets so
  // typing a "t" in the fallback command input never flips screens.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyT') return;
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      void switchMode(modeRef.current === 'player' ? 'teacher' : 'player');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [switchMode]);

  // Voice / command mode-switch requests (e.g. saying "player" to the AI
  // Teacher) are routed up from the teacher's live keyword matcher.
  useEffect(() => {
    return modeBridge.subscribe((requested) => {
      void switchMode(requested);
    });
  }, [switchMode]);

  /**
   * Spacebar / M on the AUDIO PLAYER tab: switch to the AI Teacher through the
   * shared switchMode path (audio isolation + spoken confirmation). The
   * teacher then mounts silently and opens the hands-free mic for the student
   * to speak.
   */
  useKeyboardPTT(
    () => {
      void switchMode('teacher');
    },
    () => {},
    mode === 'player'
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.modeSwitcher} accessibilityRole="tablist">
        <Pressable
          onPress={() => switchMode('player')}
          accessible={true}
          accessibilityRole="tab"
          accessibilityLabel="Audio player mode"
          accessibilityHint="Plays the lecture audio"
          accessibilityState={{ selected: mode === 'player' }}
          style={[
            styles.modeButton,
            mode === 'player' && styles.modeButtonActive,
          ]}
        >
          <Text
            style={[
              styles.modeButtonText,
              mode === 'player' && styles.modeButtonTextActive,
            ]}
          >
            Audio Player
          </Text>
        </Pressable>

        <Pressable
          onPress={() => switchMode('teacher')}
          accessible={true}
          accessibilityRole="tab"
          accessibilityLabel="AI teacher mode"
          accessibilityHint="Interactive voice tutor with hands-free commands"
          accessibilityState={{ selected: mode === 'teacher' }}
          style={[
            styles.modeButton,
            mode === 'teacher' && styles.modeButtonActive,
          ]}
        >
          <Text
            style={[
              styles.modeButtonText,
              mode === 'teacher' && styles.modeButtonTextActive,
            ]}
          >
            AI Teacher
          </Text>
        </Pressable>
      </View>

      {mode === 'player' ? <EducationalAudioPlayer /> : <AITeacherScreen />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0A0B1E',
  },
  modeSwitcher: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceElevated,
  },
  modeButton: {
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  modeButtonText: {
    color: Colors.muted,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modeButtonTextActive: {
    color: Colors.onPrimary,
  },
});
