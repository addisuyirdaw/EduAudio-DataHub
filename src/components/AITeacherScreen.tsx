/**
 * AITeacherScreen.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Main AI Teacher Mode Screen
 * 
 * Ultra-minimal design with full-bleed containers for maximum accessibility.
 * Displays current reading content with WCAG 2.2 AAA compliant contrast ratios.
 * Implements full-screen push-to-talk for voice interactions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, StatusBar } from 'react-native';
import { TeacherProvider, useTeacherContext } from '../context/TeacherContext';
import { useAITeacher } from '../hooks/useAITeacher';
import { ActiveParagraphDisplay } from './ActiveParagraphDisplay';
import { StatusIndicator } from './StatusIndicator';
import { FullScreenPTT } from './FullScreenPTT';
import { Colors } from '../styles/theme';

/**
 * Inner component that uses the teacher context
 */
const AITeacherContent: React.FC = () => {
  const {
    state,
    statusMessage,
    handleTouchDown,
    handleTouchUp,
    getAccessibilityLabel,
  } = useAITeacher();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      {/* Status Indicator */}
      <StatusIndicator state={state} accessibilityLabel={getAccessibilityLabel()} />
      
      {/* Active Paragraph Display */}
      <ActiveParagraphDisplay />
      
      {/* Full-Screen Push-to-Talk Overlay with integrated touch handlers */}
      <FullScreenPTT 
        onPressIn={handleTouchDown} 
        onPressOut={handleTouchUp} 
        isActive={state === 'LISTENING'} 
      />
      
      {/* Invisible live region for screen reader announcements */}
      <View
        accessibilityLiveRegion="polite"
        accessible={false}
        importantForAccessibility="yes"
        style={styles.liveRegion}
      >
        <Text style={styles.liveRegionText}>{statusMessage}</Text>
      </View>
    </View>
  );
};

/**
 * Main AI Teacher Screen with provider wrapper
 */
export const AITeacherScreen: React.FC = () => {
  return (
    <TeacherProvider>
      <AITeacherContent />
    </TeacherProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
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
});
