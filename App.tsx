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

import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, View, Text, Pressable } from 'react-native';
import { Audio } from 'expo-av';
import { EducationalAudioPlayer } from './src/components/EducationalAudioPlayer';
import { AITeacherScreen } from './src/components/AITeacherScreen';
import { useKeyboardPTT } from './src/hooks/useKeyboardPTT';
import { audioMutex } from './src/context/AudioMutex';
import { Colors, Typography, Spacing, Radius } from './src/styles/theme';

type Mode = 'player' | 'teacher';

export default function App() {
  const [mode, setMode] = useState<Mode>('player');

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
   * Audio isolation on tab switch: stop any in-flight TTS / mutex-tracked
   * playback before the screen swap, so the AI Teacher's spoken greeting never
   * bleeds into the player and vice-versa. The Audio Player's own sound is
   * stopped by its unmount cleanup.
   */
  const switchMode = async (nextMode: Mode): Promise<void> => {
    await audioMutex.hardPause();
    setMode(nextMode);
  };

  /**
   * Spacebar / M on the AUDIO PLAYER tab: stop playback immediately and hand
   * the speech input to the AI Teacher (which mounts, greets, and opens the
   * hands-free listening loop).
   */
  useKeyboardPTT(
    () => {
      void (async () => {
        await audioMutex.hardPause();
        setMode('teacher');
      })();
    },
    () => {},
    mode === 'player'
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.modeSwitcher}>
        <Pressable
          onPress={() => switchMode('player')}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Switch to audio player mode"
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
          accessibilityRole="button"
          accessibilityLabel="Switch to AI teacher mode"
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
