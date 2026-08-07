/**
 * AccessibleAudioPlayer.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Single-screen audio player UI for an educational assistant.
 *
 * ACCESSIBILITY ARCHITECTURE
 * ───────────────────────────
 * Every interactive element carries the minimum set of semantic props needed
 * for iOS VoiceOver and Android TalkBack to present a meaningful description:
 *
 *  • `accessible={true}`
 *      Merges child views into a single focusable node. Without this, the
 *      screen reader would announce each icon/text child separately.
 *
 *  • `accessibilityRole`
 *      Maps the element to a native platform role:
 *        "button"      → activatable control (announced as "Button" on iOS)
 *        "progressbar" → value range (VoiceOver reads position as percentage)
 *        "header"      → landmark, allows quick navigation by heading
 *        "text"        → static informational content
 *
 *  • `accessibilityLabel`
 *      Overrides the computed label with a human-friendly string.
 *      IMPORTANT: Never rely on icon-only labels; always supply this prop.
 *
 *  • `accessibilityState`
 *      Communicates widget state to the accessibility API:
 *        { disabled }  → grey-out announced as "dimmed"
 *        { selected }  → toggle state, announced as "selected / not selected"
 *        { busy }      → spinner, announced as "loading" on iOS
 *
 *  • `accessibilityValue`
 *      For range controls (progress bar), provides min/max/now/text.
 *
 *  • `accessibilityLiveRegion="polite"`
 *      Placed on the invisible status <View>. Whenever `statusMessage` changes
 *      the OS reads it aloud after the current speech finishes ("polite").
 *      Use "assertive" only for time-critical alerts (e.g. errors).
 *
 *  • `importantForAccessibility`
 *      Set to "no-hide-descendants" on purely decorative elements (waveform
 *      bars, background gradients) so the screen reader skips them entirely.
 *
 * TOUCH TARGET SIZES
 * ──────────────────
 * All Pressable wrappers enforce minWidth/minHeight of MIN_TOUCH_TARGET (55 dp).
 * The "Ask AI" button is flex:0.30 of screen height and full width — far
 * exceeding the minimum.
 *
 * COLOR CONTRAST
 * ──────────────
 * All text / icon colours in this file reference Colors tokens from theme.ts.
 * Every token has been verified at ≥ 7:1 contrast against its background
 * (see theme.ts for the full table).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  Platform,
  StatusBar,
  ScrollView,
  AccessibilityInfo,
} from 'react-native';
import { useAccessibilityAudio } from '../hooks/useAccessibilityAudio';
import { Colors, Typography, Spacing, Radius, MIN_TOUCH_TARGET } from '../styles/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransportButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
  size?: number;
}

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
 * TransportButton
 * Wraps a Pressable with guaranteed minimum touch target, pressed feedback,
 * and all required accessibility props.
 */
const TransportButton: React.FC<TransportButtonProps> = ({
  onPress,
  accessibilityLabel,
  disabled = false,
  children,
  size = MIN_TOUCH_TARGET,
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    // `accessible` + `accessibilityRole` + `accessibilityLabel` are the three
    // pillars of a usable screen-reader button.
    accessible={true}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    // `accessibilityState.disabled` causes VoiceOver to say "dimmed" and
    // TalkBack to say "unavailable", preventing user confusion.
    accessibilityState={{ disabled }}
    style={({ pressed }) => [
      styles.transportButton,
      { width: size, height: size },
      pressed && styles.transportButtonPressed,
      disabled && styles.transportButtonDisabled,
    ]}
  >
    {children}
  </Pressable>
);

/**
 * WaveformVisualisation
 * Purely decorative — hidden from the accessibility tree so screen readers
 * don't announce "unlabelled image" or attempt to read bar heights.
 */
const WaveformVisualisation: React.FC<{ progress: number }> = ({ progress }) => {
  const BAR_COUNT = 40;
  const bars = useMemo(() => {
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      // Create a natural-looking sine wave with slight randomness
      const angle = (i / BAR_COUNT) * Math.PI * 6;
      const height = 20 + Math.abs(Math.sin(angle) * 38) + Math.cos(angle * 1.7) * 10;
      return Math.max(8, Math.min(70, height));
    });
  }, []);

  return (
    // `importantForAccessibility="no-hide-descendants"` hides this entire
    // subtree from VoiceOver and TalkBack — it is purely decorative.
    <View
      style={styles.waveformContainer}
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
              styles.waveformBar,
              {
                height,
                backgroundColor: isPast ? Colors.accent : Colors.surfaceElevated,
                opacity: isPast ? 1 : 0.5,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

/**
 * ProgressBar
 * Accessible progress indicator with `accessibilityRole="progressbar"` and
 * `accessibilityValue` providing current/min/max/text for screen readers.
 */
const ProgressBar: React.FC<{
  positionMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
  skipForward?: () => void;
  skipBackward?: () => void;
}> = ({ positionMs, durationMs, onSeek, skipForward, skipBackward }) => {
  const progress = safeProgress(positionMs, durationMs);
  const positionLabel = formatTime(positionMs);
  const durationLabel = formatTime(durationMs);

  const handlePress = useCallback(
    (event: any) => {
      if (!durationMs) return;
      const { locationX, target } = event.nativeEvent;
      // Approximate the bar width via layout measurement
      const BAR_WIDTH = Dimensions.get('window').width - Spacing.lg * 2;
      const ratio = Math.min(1, Math.max(0, locationX / BAR_WIDTH));
      onSeek(ratio * durationMs);
    },
    [durationMs, onSeek]
  );

  return (
    <Pressable
      onPress={handlePress}
      // Role "progressbar" maps to UIAccessibilityTraitAdjustable on iOS,
      // letting swipe-up/down gestures adjust value in VoiceOver.
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel={`Lecture progress, ${positionLabel} of ${durationLabel}`}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(progress * 100),
        text: `${positionLabel} of ${durationLabel}`,
      }}
      accessibilityActions={[
        { name: 'increment', label: 'Seek forward 15 seconds' },
        { name: 'decrement', label: 'Seek backward 15 seconds' },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment' && skipForward) {
          skipForward();
        } else if (event.nativeEvent.actionName === 'decrement' && skipBackward) {
          skipBackward();
        }
      }}
      style={styles.progressContainer}
    >
      {/* Track */}
      <View style={styles.progressTrack}>
        {/* Fill */}
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        {/* Thumb */}
        <View
          style={[styles.progressThumb, { left: `${progress * 100}%` as any }]}
        />
      </View>

      {/* Time labels — hidden from a11y since the parent already provides the text */}
      <View
        style={styles.progressTimestamps}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden={true}
      >
        <Text style={styles.timestampText}>{positionLabel}</Text>
        <Text style={styles.timestampText}>{durationLabel}</Text>
      </View>
    </Pressable>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const AccessibleAudioPlayer: React.FC = () => {
  const {
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
  } = useAccessibilityAudio();

  const progress = safeProgress(positionMs, durationMs);

  // ── Course metadata (replace with real data / props) ──────────────────────
  const courseTitle = 'Introduction to Cognitive Psychology';
  const episodeTitle = 'Chapter 3: Memory & Learning';
  const instructor = 'Dr. Sarah Chen';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── INVISIBLE LIVE REGION ──────────────────────────────────────────
          This View has zero visual size but carries `accessibilityLiveRegion`.
          When `statusMessage` changes, the OS reads the new text aloud
          ("politely" — i.e., after current speech finishes).
          It must remain mounted and contain visible text to work correctly
          on both iOS and Android.
      ──────────────────────────────────────────────────────────────────── */}
      <View
        accessibilityLiveRegion="polite"
        // `accessible={false}` prevents the region itself from being a focus
        // target; only its text content is announced when it changes.
        accessible={false}
        style={styles.liveRegion}
        // Android requires importantForAccessibility="yes" on the live region
        importantForAccessibility="yes"
      >
        <Text style={styles.liveRegionText}>{statusMessage}</Text>
      </View>

      {/* ── AI LISTENING OVERLAY ──────────────────────────────────────────── */}
      {isAIListening && (
        <View style={styles.aiOverlay} pointerEvents="none">
          <View style={styles.aiPulseRing} />
          <View style={styles.aiPulseRingOuter} />
          <Text style={styles.aiOverlayText}>🎤  Listening…</Text>
          <Text style={styles.aiOverlaySubtext}>Speak your question clearly</Text>
        </View>
      )}

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <View
        style={styles.header}
        accessible={true}
        // `accessibilityRole="header"` creates a landmark that VoiceOver users
        // can jump to directly via the rotor.
        accessibilityRole="header"
        accessibilityLabel={`${courseTitle}. ${episodeTitle}. Instructor: ${instructor}`}
      >
        <Text
          style={styles.courseTitle}
          numberOfLines={1}
          // Individual Text nodes are hidden; parent View is the a11y element.
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden={true}
        >
          {courseTitle}
        </Text>
        <Text
          style={styles.episodeTitle}
          numberOfLines={2}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden={true}
        >
          {episodeTitle}
        </Text>
        <Text
          style={styles.instructorLabel}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden={true}
        >
          {instructor}
        </Text>
      </View>

      {/* ── ARTWORK / WAVEFORM AREA ────────────────────────────────────────── */}
      <View style={styles.artworkArea}>
        {/* Decorative waveform — hidden from screen readers */}
        <WaveformVisualisation progress={progress} />

        {/* Chapter badge */}
        <View
          style={styles.chapterBadge}
          accessible={true}
          accessibilityRole="text"
          accessibilityLabel="Chapter 3 of 12"
        >
          <Text style={styles.chapterBadgeText}>Ch. 3 / 12</Text>
        </View>
      </View>

      {/* ── PROGRESS BAR ──────────────────────────────────────────────────── */}
      <View style={styles.progressSection}>
        <ProgressBar
          positionMs={positionMs}
          durationMs={durationMs}
          onSeek={seekTo}
          skipForward={skipForward15}
          skipBackward={skipBackward15}
        />
      </View>

      {/* ── TRANSPORT CONTROLS ────────────────────────────────────────────── */}
      <View
        style={styles.transportRow}
        // Group label for the entire transport row so VoiceOver can describe
        // the section when navigating by container.
        accessible={false}
        accessibilityLabel="Playback controls"
      >
        {/* Skip Backward 15s */}
        <TransportButton
          onPress={skipBackward15}
          accessibilityLabel="Skip back 15 seconds"
          disabled={isLoading}
        >
          <Text style={styles.transportIcon}>⏮</Text>
          <Text style={styles.transportLabel}>15s</Text>
        </TransportButton>

        {/* Play / Pause — larger, central button */}
        <TransportButton
          onPress={togglePlayPause}
          accessibilityLabel={isLoading ? 'Loading audio' : isPlaying ? 'Pause lecture' : 'Play lecture'}
          disabled={isLoading}
          size={72}
        >
          {/* `accessibilityState.busy` triggers "loading" announcement */}
          <View
            accessible={false}
            accessibilityState={{ busy: isLoading }}
            style={styles.playButtonInner}
          >
            {isLoading ? (
              <Text style={styles.playIcon}>⏳</Text>
            ) : isPlaying ? (
              <Text style={styles.playIcon}>⏸</Text>
            ) : (
              <Text style={styles.playIcon}>▶</Text>
            )}
          </View>
        </TransportButton>

        {/* Skip Forward 15s */}
        <TransportButton
          onPress={skipForward15}
          accessibilityLabel="Skip forward 15 seconds"
          disabled={isLoading}
        >
          <Text style={styles.transportIcon}>⏭</Text>
          <Text style={styles.transportLabel}>15s</Text>
        </TransportButton>
      </View>

      {/* ── ASK AI BUTTON ─────────────────────────────────────────────────────
          Occupies 30% of screen height (flex: 0.30 relative to remaining space
          after the fixed-height header/controls). Full viewport width.
          This makes it trivially easy to activate without looking at the screen.
      ──────────────────────────────────────────────────────────────────────── */}
      <Pressable
        onPress={toggleAI}
        accessible={true}
        accessibilityRole="button"
        // Descriptive label tells the user both the action and the current state.
        accessibilityLabel={
          isAIListening
            ? 'Ask AI. Currently listening. Double-tap to stop.'
            : 'Ask AI. Double-tap to activate voice command and ask a question about this lecture.'
        }
        // `accessibilityState.selected` signals a toggle that is currently ON.
        // VoiceOver announces "selected" / "not selected" appended to the label.
        accessibilityState={{ selected: isAIListening }}
        style={({ pressed }) => [
          styles.askAiButton,
          isAIListening && styles.askAiButtonActive,
          pressed && styles.askAiButtonPressed,
        ]}
      >
        {/* Mic icon row */}
        <View style={styles.askAiIconRow}>
          <View style={[styles.micCircle, isAIListening && styles.micCircleActive]}>
            <Text style={styles.micIcon}>🎤</Text>
          </View>
        </View>

        <Text style={styles.askAiLabel}>
          {isAIListening ? 'Listening…' : 'Ask AI'}
        </Text>
        <Text style={styles.askAiSublabel}>
          {isAIListening
            ? 'Speak your question about this lecture'
            : 'Ask anything about this lecture'}
        </Text>

        {/* Animated dot indicator when listening */}
        {isAIListening && (
          <View style={styles.listeningDots}>
            <View style={[styles.dot, styles.dotActive]} />
            <View style={[styles.dot, styles.dotActive, { opacity: 0.7 }]} />
            <View style={[styles.dot, styles.dotActive, { opacity: 0.4 }]} />
          </View>
        )}
      </Pressable>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const styles = StyleSheet.create({
  // ── Root ──────────────────────────────────────────────────────────────────
  root: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 0,
  },

  // ── Live Region ───────────────────────────────────────────────────────────
  // Visually hidden but accessible — uses 1×1 clip to remain "visible" to
  // the a11y tree (display:none or opacity:0 can suppress live regions on
  // some Android versions).
  liveRegion: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    top: 0,
    left: 0,
    // Clipped off-screen — not truly off-screen (that can break Android LR)
  },
  liveRegionText: {
    color: Colors.onSurface,
    fontSize: 1,
  },

  // ── AI Listening Overlay ──────────────────────────────────────────────────
  aiOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(13, 13, 26, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  aiPulseRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: Colors.aiActive,
    opacity: 0.6,
  },
  aiPulseRingOuter: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: Colors.aiActive,
    opacity: 0.3,
  },
  aiOverlayText: {
    color: Colors.aiActive,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    marginTop: Spacing.lg,
  },
  aiOverlaySubtext: {
    color: Colors.muted,
    fontSize: Typography.size.md,
    marginTop: Spacing.sm,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceElevated,
  },
  courseTitle: {
    color: Colors.muted,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: Spacing.xs,
  },
  episodeTitle: {
    color: Colors.onSurface,
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
    lineHeight: 26,
    marginBottom: Spacing.xs,
  },
  instructorLabel: {
    color: Colors.accent,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
  },

  // ── Artwork / Waveform ────────────────────────────────────────────────────
  artworkArea: {
    flex: 1,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceElevated,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.md,
  },
  waveformBar: {
    width: 4,
    borderRadius: 2,
  },
  chapterBadge: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  chapterBadgeText: {
    color: Colors.muted,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semiBold,
  },

  // ── Progress ──────────────────────────────────────────────────────────────
  progressSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  progressContainer: {
    paddingVertical: Spacing.sm,
  },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 3,
    overflow: 'visible',
    position: 'relative',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  progressThumb: {
    position: 'absolute',
    top: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    marginLeft: -9,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  progressTimestamps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  timestampText: {
    color: Colors.muted,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.medium,
  },

  // ── Transport ─────────────────────────────────────────────────────────────
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  transportButton: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceElevated,
  },
  transportButtonPressed: {
    backgroundColor: Colors.pressedOverlay,
    borderColor: Colors.primary,
    transform: [{ scale: 0.95 }],
  },
  transportButtonDisabled: {
    opacity: 0.4,
  },
  transportIcon: {
    fontSize: 20,
    color: Colors.onSurface,
    textAlign: 'center',
  },
  transportLabel: {
    fontSize: Typography.size.xs,
    color: Colors.muted,
    fontWeight: Typography.weight.bold,
    textAlign: 'center',
  },
  playButtonInner: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  playIcon: {
    fontSize: 28,
    color: Colors.onPrimary,
    textAlign: 'center',
  },

  // ── Ask AI Button ─────────────────────────────────────────────────────────
  askAiButton: {
    // Occupies 30% of total screen height
    height: SCREEN_HEIGHT * 0.30,
    width: '100%',
    backgroundColor: Colors.aiBackground,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceElevated,
    gap: Spacing.xs,
  },
  askAiButtonActive: {
    backgroundColor: Colors.aiActiveBackground,
    borderTopColor: Colors.aiActive,
  },
  askAiButtonPressed: {
    opacity: 0.85,
  },
  askAiIconRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  micCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  micCircleActive: {
    borderColor: Colors.aiActive,
    shadowColor: Colors.aiActive,
    backgroundColor: Colors.aiActiveBackground,
  },
  micIcon: {
    fontSize: 24,
  },
  askAiLabel: {
    color: Colors.onSurface,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    letterSpacing: 0.5,
  },
  askAiSublabel: {
    color: Colors.muted,
    fontSize: Typography.size.sm,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
  listeningDots: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.aiActive,
  },
  dotActive: {
    backgroundColor: Colors.aiActive,
  },
});

export default AccessibleAudioPlayer;
