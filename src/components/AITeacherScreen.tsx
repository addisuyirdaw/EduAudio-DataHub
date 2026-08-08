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

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, StatusBar, TextInput } from 'react-native';
import { TeacherProvider } from '../context/TeacherContext';
import { useAITeacher } from '../hooks/useAITeacher';
import { useKeyboardPTT } from '../hooks/useKeyboardPTT';
import { ActiveParagraphDisplay } from './ActiveParagraphDisplay';
import { StatusIndicator } from './StatusIndicator';
import { FullScreenPTT } from './FullScreenPTT';
import { Colors, Spacing, Typography } from '../styles/theme';

/**
 * Inner component that uses the teacher context
 */
const AITeacherContent: React.FC = () => {
  const {
    state,
    statusMessage,
    recognizedText,
    handleTouchDown,
    handleTouchUp,
    submitTextCommand,
    getAccessibilityLabel,
  } = useAITeacher();

  const [typedCommand, setTypedCommand] = useState('');

  // Global Spacebar / M hotkey -> Push-To-Talk (web builds) for keyboard and
  // screen-reader users who cannot use mouse/touch.
  useKeyboardPTT(handleTouchDown, handleTouchUp);

  const handleSubmitCommand = () => {
    const command = typedCommand.trim();
    if (!command) return;
    setTypedCommand('');
    void submitTextCommand(command);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      {/* Status Indicator */}
      <StatusIndicator state={state} accessibilityLabel={getAccessibilityLabel()} />
      
      {/* Active Paragraph Display */}
      <ActiveParagraphDisplay />
      
      {/* Fallback text command input (speech-recognition-restricted browsers) */}
      <View style={styles.commandInputContainer}>
        <TextInput
          style={styles.commandInput}
          value={typedCommand}
          onChangeText={setTypedCommand}
          onSubmitEditing={handleSubmitCommand}
          placeholder="Type a command (e.g. next, explain arrays)..."
          placeholderTextColor={Colors.muted}
          returnKeyType="send"
          accessibilityLabel="Command input"
          accessibilityHint="Type a voice command like next or a question, then press enter"
        />
      </View>
      
      {/* Full-Screen Push-to-Talk Overlay with integrated touch handlers */}
      <FullScreenPTT 
        onPressIn={handleTouchDown} 
        onPressOut={handleTouchUp} 
        isActive={state === 'LISTENING'} 
        transcript={recognizedText}
      />
      
      {/* Invisible live region for screen reader announcements */}
      <View
        accessibilityLiveRegion="polite"
        accessible={false}
        importantForAccessibility="yes"
        style={styles.liveRegion}
      >
        <Text style={styles.liveRegionText}>
          {statusMessage}
          {recognizedText ? ` — Captured: ${recognizedText}` : ''}
        </Text>
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
  commandInputContainer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    // Keep the input above the full-bleed PTT overlay so it stays tappable.
    zIndex: 10,
    elevation: 10,
  },
  commandInput: {
    backgroundColor: Colors.surface,
    color: Colors.onSurface,
    borderColor: Colors.primary,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.size.md,
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
