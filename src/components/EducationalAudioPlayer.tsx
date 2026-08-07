/**
 * EducationalAudioPlayer.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Core mobile player screen layout for an educational assistant.
 * 
 * ACCESSIBILITY & CONTRAST DETAILS:
 * - Background: #0A0B1E (deep midnight navy)
 * - Accent Purple: #9D8BFF (bright lavender-purple, contrast ratio > 7:1 against background)
 * - Audio Container Background: #16162A (slightly lighter dark blue-grey)
 * - Grouped Header accessibilityLabel="Course: Introduction to Cognitive Psychology. Chapter 3: Memory and Learning by Doctor Sarah Chen"
 * - Live Region: accessibilityLiveRegion="assertive" for immediate status updates.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  Platform,
  StatusBar,
  PixelRatio,
} from 'react-native';
import { RotateCcw, RotateCw, Play, Pause, Mic } from 'lucide-react-native';
import { useEducationalAudio } from '../hooks/useEducationalAudio';
import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import { AdaptiveHeaderZone } from './AdaptiveHeaderZone';
import { AdaptiveHUDZone } from './AdaptiveHUDZone';
import { Colors, Typography, Spacing, Radius, MIN_TOUCH_TARGET } from '../styles/theme';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FONT_SCALE = PixelRatio.getFontScale(); // Detect system font scaling

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format milliseconds as "m:ss" */
function formatTime(ms: number): string {
  if (!ms || ms < 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Compute progress percentage (0–1) safely */
function safeProgress(position: number, duration: number): number {
  if (!duration || duration <= 0) return 0;
  return Math.min(1, Math.max(0, position / duration));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * VisualizerBars
 * Renders a centered, stylized audio visualization placeholder graphic.
 */
const VisualizerBars: React.FC<{ isPlaying: boolean; progress: number }> = ({
  isPlaying,
  progress,
}) => {
  const BAR_COUNT = 24;
  const bars = useMemo(() => {
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      // Create a wave shape (taller in the middle, shorter at edges)
      const distFromCenter = Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2);
      const baseHeight = 12 + (1 - distFromCenter) * 38;
      return Math.max(8, Math.min(50, baseHeight));
    });
  }, []);

  return (
    <View 
      style={styles.visualizerContainer}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden={true}
    >
      {bars.map((height, i) => {
        const barProgress = i / BAR_COUNT;
        const isPast = barProgress <= progress;
        return (
          <View
            key={i}
            style={[
              styles.visualizerBar,
              {
                height: isPlaying ? height * (0.8 + Math.random() * 0.4) : height,
                backgroundColor: isPast ? Colors.primary : Colors.surfaceElevated,
                opacity: isPast ? 1 : 0.6,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const EducationalAudioPlayer: React.FC = () => {
  const {
    isPlaying,
    isLoading,
    positionMs,
    durationMs,
    playbackSpeed,
    currentChunkIndex,
    currentChunkText,
    isAIListening,
    statusAnnouncement,
    togglePlayPause,
    skipBackward15,
    skipForward15,
    cyclePlaybackSpeed,
    toggleAI,
    seekTo,
  } = useEducationalAudio();

  const adaptiveConfig = useAdaptiveLayout();
  const progress = safeProgress(positionMs, durationMs);

  // Formatted position and duration labels
  const positionLabel = formatTime(positionMs);
  const durationLabel = formatTime(durationMs || 372000); // 6:12 default fallback

  const handleProgressBarPress = (event: any) => {
    if (!durationMs) return;
    const { locationX } = event.nativeEvent;
    const BAR_WIDTH = SCREEN_WIDTH - 64; // width minus horizontal margins
    const ratio = Math.min(1, Math.max(0, locationX / BAR_WIDTH));
    seekTo(ratio * durationMs);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── ASSERTIVE LIVE REGION ──────────────────────────────────────────
          This invisible view uses accessibilityLiveRegion="assertive" to
          immediately announce status updates (such as paragraph transitions,
          playback speed cycles, and timeline skips) to screen readers.
      ──────────────────────────────────────────────────────────────────── */}
      <View
        accessibilityLiveRegion="assertive"
        accessible={false}
        importantForAccessibility="yes"
        style={styles.liveRegion}
      >
        <Text style={styles.liveRegionText}>{statusAnnouncement}</Text>
      </View>

      {/* ── PORTRAIT VERTICAL STACK ──────────────────────────────────────── */}
      
      {/* HEADER ZONE (Top 15%) - Adaptive with scrollable fallback */}
      <AdaptiveHeaderZone
        config={adaptiveConfig}
        courseTitle="Introduction to Cognitive Psychology"
        chapterTitle="Chapter 3: Memory & Learning"
        instructorName="Dr. Sarah Chen"
      />

      {/* READING VIEWPORT ZONE (Middle 45%) - Dynamic typography */}
      <View style={[styles.readingViewport, { flex: adaptiveConfig.readingViewport.flex }]}>
        <View style={styles.paragraphScrollContainer}>
          <Text 
            style={[
              styles.readingText,
              { fontSize: 20 * adaptiveConfig.textMultiplier } // Use adaptive text multiplier
            ]}
            numberOfLines={8}
            ellipsizeMode="tail"
          >
            {currentChunkText}
          </Text>
        </View>
        
        {/* Minimal progress indicator */}
        <View style={styles.minimalProgress}>
          <Text style={[styles.progressText, { fontSize: 12 * adaptiveConfig.textMultiplier }]}>
            {positionLabel} / {durationLabel}
          </Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        </View>
      </View>

      {/* TACTILE MEDIA CONTROL ROW (Lower 20%) - Thumb-friendly with adaptive touch targets */}
      <View style={[styles.mediaControlZone, { flex: adaptiveConfig.mediaControlZone.flex, minHeight: adaptiveConfig.mediaControlZone.minHeight }]}>
        <View style={styles.controlsRow}>
          {/* Skip Backward 15s */}
          <Pressable
            onPress={skipBackward15}
            disabled={isLoading}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Skip backward 15 seconds"
            accessibilityState={{ disabled: isLoading }}
            style={({ pressed }) => [
              styles.skipButton,
              { minWidth: adaptiveConfig.skipButtonSize, minHeight: adaptiveConfig.skipButtonSize },
              pressed && styles.controlButtonPressed,
              isLoading && styles.controlButtonDisabled,
            ]}
          >
            <RotateCcw size={24} color={Colors.primary} />
            <Text style={[styles.skipLabel, { fontSize: 10 * adaptiveConfig.textMultiplier }]}>15s</Text>
          </Pressable>

          {/* Play / Pause Toggle (Oversized central button) */}
          <Pressable
            onPress={togglePlayPause}
            disabled={isLoading}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isLoading ? 'Loading audio' : isPlaying ? 'Pause lecture playback, holding down anywhere else will activate the voice teacher' : 'Play lecture playback, holding down anywhere else will activate the voice teacher'}
            accessibilityState={{ busy: isLoading }}
            style={({ pressed }) => [
              styles.playButton,
              { minWidth: adaptiveConfig.playButtonSize, minHeight: adaptiveConfig.playButtonSize },
              pressed && styles.controlButtonPressed,
              isLoading && styles.controlButtonDisabled,
            ]}
          >
            {isPlaying ? (
              <Pause size={32} color={Colors.onPrimary} strokeWidth={2.5} />
            ) : (
              <Play size={32} color={Colors.onPrimary} strokeWidth={2.5} style={{ marginLeft: 4 }} />
            )}
          </Pressable>

          {/* Skip Forward 15s */}
          <Pressable
            onPress={skipForward15}
            disabled={isLoading}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Skip forward 15 seconds"
            accessibilityState={{ disabled: isLoading }}
            style={({ pressed }) => [
              styles.skipButton,
              { minWidth: adaptiveConfig.skipButtonSize, minHeight: adaptiveConfig.skipButtonSize },
              pressed && styles.controlButtonPressed,
              isLoading && styles.controlButtonDisabled,
            ]}
          >
            <RotateCw size={24} color={Colors.primary} />
            <Text style={[styles.skipLabel, { fontSize: 10 * adaptiveConfig.textMultiplier }]}>15s</Text>
          </Pressable>
        </View>
      </View>

      {/* CONTEXTUAL HUD ZONE (Bottom 20%) - Adaptive with scrollable fallback */}
      <AdaptiveHUDZone
        config={adaptiveConfig}
        playbackSpeed={playbackSpeed}
        isAIListening={isAIListening}
        onSpeedPress={cyclePlaybackSpeed}
        onAIPress={toggleAI}
      />

      {/* ── FULL-SCREEN PTT OVERLAY ────────────────────────────────────────
          Routes gestures to FullScreenPTT while allowing controls to intercept
      ──────────────────────────────────────────────────────────────────── */}
      <Pressable
        onPress={toggleAI}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Hold to talk to AI Teacher"
        accessibilityHint="Touch and hold anywhere on the screen to activate voice command"
        style={styles.fullScreenOverlay}
      >
        {isAIListening && (
          <View style={styles.aiOverlay} pointerEvents="none">
            <View style={styles.aiPulseRing} />
            <View style={styles.aiPulseRingOuter} />
          </View>
        )}
      </Pressable>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background, // Theme Background
  },
  
  // Invisible Live Region
  liveRegion: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    top: 0,
    left: 0,
  },
  liveRegionText: {
    color: Colors.onSurface,
    fontSize: 1,
  },

  // ── HEADER ZONE (Top 15%) ───────────────────────────────────────────
  headerZone: {
    flex: 0.15,
    paddingHorizontal: Spacing.lg,
    paddingTop: Platform.OS === 'android' ? 40 : 20,
    justifyContent: 'center',
  },
  headerContent: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  courseTitle: {
    color: Colors.primary,
    fontSize: 14 / FONT_SCALE,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  chapterTitle: {
    color: Colors.onSurface,
    fontSize: 24 / FONT_SCALE,
    fontWeight: '700',
    lineHeight: 32 / FONT_SCALE,
    marginBottom: 4,
  },
  instructorName: {
    color: Colors.muted,
    fontSize: 16 / FONT_SCALE,
    fontWeight: '500',
  },

  // ── READING VIEWPORT ZONE (Middle 45%) ────────────────────────────────
  readingViewport: {
    flex: 0.45,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  paragraphScrollContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  readingText: {
    color: Colors.onSurface,
    fontSize: 20, // Base size, adjusted by FONT_SCALE dynamically
    lineHeight: 28,
    textAlign: 'left',
    fontWeight: '500',
  },
  minimalProgress: {
    marginTop: Spacing.sm,
  },
  progressText: {
    color: Colors.muted,
    fontSize: 12 / FONT_SCALE,
    fontWeight: '600',
    marginBottom: 4,
  },
  progressBar: {
    height: 3,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 2,
  },
  progressFill: {
    height: 3,
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  visualizerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 60,
    gap: 3,
    marginBottom: Spacing.md,
  },
  visualizerBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceElevated,
  },

  // ── TACTILE MEDIA CONTROL ROW (Lower 20%) ────────────────────────────
  mediaControlZone: {
    flex: 0.20,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  skipButton: {
    minWidth: 56, // WCAG AAA minimum
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLabel: {
    fontSize: 10 / FONT_SCALE,
    color: Colors.primary,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  playButton: {
    minWidth: 72, // Oversized central button (72x72dp)
    minHeight: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  controlButtonPressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.9,
  },
  controlButtonDisabled: {
    opacity: 0.4,
  },

  // ── CONTEXTUAL HUD ZONE (Bottom 20%) ───────────────────────────────────
  hudZone: {
    flex: 0.20,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  speedButton: {
    minWidth: 100,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  speedButtonText: {
    color: Colors.primary,
    fontSize: 12 / FONT_SCALE,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  aiHintText: {
    color: Colors.muted,
    fontSize: 13 / FONT_SCALE,
    textAlign: 'center',
    flex: 1,
    marginHorizontal: Spacing.md,
  },
  aiMiniButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiMiniButtonActive: {
    backgroundColor: Colors.aiActiveBackground,
    borderColor: Colors.aiActive,
  },

  // ── FULL-SCREEN PTT OVERLAY ───────────────────────────────────────────
  fullScreenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  aiOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 11, 30, 0.5)',
  },
  aiPulseRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: Colors.aiActive,
    opacity: 0.6,
  },
  aiPulseRingOuter: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1.5,
    borderColor: Colors.aiActive,
    opacity: 0.25,
  },
});

export default EducationalAudioPlayer;
