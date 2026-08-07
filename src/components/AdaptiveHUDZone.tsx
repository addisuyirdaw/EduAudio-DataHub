/**
 * AdaptiveHUDZone.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Adaptive HUD Zone Component
 * 
 * Automatically transitions between fixed height and scrollable layout
 * based on font scaling to prevent text clipping at 200%+ system font scaling.
 * Contains speed controller, AI hint text, and mini AI toggle button.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Mic } from 'lucide-react-native';
import { Colors, Spacing, MIN_TOUCH_TARGET } from '../styles/theme';
import type { AdaptiveLayoutConfig } from '../hooks/useAdaptiveLayout';

interface AdaptiveHUDZoneProps {
  config: AdaptiveLayoutConfig;
  playbackSpeed: number;
  isAIListening: boolean;
  onSpeedPress: () => void;
  onAIPress: () => void;
}

export const AdaptiveHUDZone: React.FC<AdaptiveHUDZoneProps> = ({
  config,
  playbackSpeed,
  isAIListening,
  onSpeedPress,
  onAIPress,
}) => {
  const { hudZone, textMultiplier } = config;

  const Content = () => (
    <View style={styles.hudContent}>
      <Pressable
        onPress={onSpeedPress}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Playback speed, currently ${playbackSpeed}x`}
        accessibilityHint="Cycles the playback speed between 1x, 1.5x, 2x, 2.5x, 3x, and 3.5x"
        style={({ pressed }) => [
          styles.speedButton,
          pressed && styles.controlButtonPressed,
        ]}
      >
        <Text style={[styles.speedButtonText, { fontSize: 12 * textMultiplier }]}>
          {playbackSpeed}x SPEED
        </Text>
      </Pressable>
      
      <Text style={[styles.aiHintText, { fontSize: 13 * textMultiplier }]}>
        Hold down anywhere else to talk to AI Teacher.
      </Text>
      
      <Pressable
        onPress={onAIPress}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={isAIListening ? 'Ask AI, currently listening' : 'Ask AI'}
        accessibilityHint={
          isAIListening
            ? 'Double-tap to cancel listening'
            : 'Double-tap to activate voice command and ask a question about this lecture'
        }
        accessibilityState={{ selected: isAIListening }}
        style={({ pressed }) => [
          styles.aiMiniButton,
          isAIListening && styles.aiMiniButtonActive,
          pressed && styles.controlButtonPressed,
        ]}
      >
        <Mic size={20} color={isAIListening ? Colors.aiActive : Colors.primary} strokeWidth={2} />
      </Pressable>
    </View>
  );

  if (hudZone.scrollable) {
    return (
      <ScrollView
        style={[styles.hudZone, { flex: hudZone.flex, minHeight: hudZone.minHeight }]}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled={true}
        showsVerticalScrollIndicator={false}
      >
        <Content />
      </ScrollView>
    );
  }

  return (
    <View style={[styles.hudZone, { flex: hudZone.flex }]}>
      <Content />
    </View>
  );
};

const styles = StyleSheet.create({
  hudZone: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  hudContent: {
    justifyContent: 'space-between',
    alignItems: 'center',
    flexDirection: 'row',
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
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  aiHintText: {
    color: Colors.muted,
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
  controlButtonPressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.9,
  },
});
