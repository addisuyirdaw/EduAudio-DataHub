/**
 * FullScreenPTT.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full-Screen Push-to-Talk Overlay
 * 
 * Entire viewport becomes a gesture-responsive control surface.
 * Tapping anywhere activates voice interaction for maximum accessibility.
 * Full-bleed container ensures no accidental misses of touch targets.
 * 
 * Features:
 * - PanResponder for touch down/up detection
 * - Touch filtering to prevent glancing touches (< 150ms)
 * - Haptic feedback on touch down and release
 * - Integration with FSM state transitions
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Text, PanResponder, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../styles/theme';

interface FullScreenPTTProps {
  onPressIn: () => void;
  onPressOut: () => void;
  isActive: boolean;
  transcript?: string;
}

const GLANCING_TOUCH_THRESHOLD = 150; // ms - filter out accidental taps

export const FullScreenPTT: React.FC<FullScreenPTTProps> = ({ onPressIn, onPressOut, isActive, transcript }) => {
  const touchStartTimeRef = useRef<number>(0);
  const touchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * PanResponder configuration for touch detection
   */
  const panResponder = useRef(
    PanResponder.create({
      // Allow the responder to capture touches
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,

      // Touch down - activate listening
      onPanResponderGrant: () => {
        touchStartTimeRef.current = Date.now();
        
        // Fire high-priority haptic pulse for microphone open
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        
        // Trigger FSM transition to LISTENING state
        onPressIn();
        
        console.log('[FullScreenPTT] Touch down, activating listening');
      },

      // Touch up - process voice input
      onPanResponderRelease: () => {
        const touchDuration = Date.now() - touchStartTimeRef.current;
        
        // Filter out glancing touches (< 150ms)
        if (touchDuration < GLANCING_TOUCH_THRESHOLD) {
          console.log('[FullScreenPTT] Glancing touch detected, ignoring');
          return;
        }

        // Fire subtle haptic confirmation for microphone close
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        
        // Trigger FSM transition to PROCESSING state
        onPressOut();
        
        console.log('[FullScreenPTT] Touch released, processing voice input');
      },

      // Handle touch cancellation
      onPanResponderTerminate: () => {
        console.log('[FullScreenPTT] Touch cancelled');
        
        // Clean up any pending timeouts
        if (touchTimeoutRef.current) {
          clearTimeout(touchTimeoutRef.current);
          touchTimeoutRef.current = null;
        }
      },

      // Prevent default gesture handling
      onShouldBlockNativeResponder: () => true,
    })
  ).current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (touchTimeoutRef.current) {
        clearTimeout(touchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <View
      {...panResponder.panHandlers}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={isActive ? 'Listening. Release to send command.' : 'Press and hold anywhere to ask a question'}
      accessibilityHint="Press and hold to activate voice command, release to send"
      style={[
        styles.container,
        isActive && styles.containerActive,
      ]}
    >
      {/* Visual feedback when listening */}
      {isActive && (
        <View style={styles.activeIndicator}>
          <View style={styles.pulseRing} />
          <View style={styles.pulseRingOuter} />
          <Text style={styles.listeningText}>Listening...</Text>
          {/* Live transcript debugger: shows exactly what the browser speech
              engine is capturing, updating on every interim result. Never
              substitute a placeholder here — an empty transcript renders as
              an empty string so the overlay can't get stuck on "Listening...". */}
          <Text style={styles.debugTranscript}>
            Heard: "{transcript || ''}"
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
  },
  containerActive: {
    backgroundColor: 'rgba(10, 11, 30, 0.3)',
  },
  containerPressed: {
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
  },
  activeIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: '#F472B6',
    opacity: 0.6,
  },
  pulseRingOuter: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: '#F472B6',
    opacity: 0.3,
  },
  listeningText: {
    color: Colors.onSurface,
    fontSize: 24,
    fontWeight: '700',
    marginTop: Spacing.lg,
    textAlign: 'center',
  },
  debugTranscript: {
    color: Colors.onSurface,
    fontSize: Typography.size.md,
    fontWeight: '400',
    marginTop: Spacing.md,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
});
