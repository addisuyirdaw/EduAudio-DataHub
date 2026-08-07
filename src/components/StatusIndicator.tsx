/**
 * StatusIndicator.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Status Indicator Component
 * 
 * Minimal state indicator showing the current teacher mode state.
 * Provides accessibility labels for screen readers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { TeacherState } from '../types/teacher.types';
import { Colors, Typography, Spacing } from '../styles/theme';

interface StatusIndicatorProps {
  state: TeacherState;
  accessibilityLabel: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  state,
  accessibilityLabel,
}) => {
  const getStateText = (currentState: TeacherState): string => {
    switch (currentState) {
      case 'IDLE':
        return 'Ready';
      case 'PARSING_DOC':
        return 'Parsing...';
      case 'AI_SPEAKING':
        return 'Reading';
      case 'LISTENING':
        return 'Listening';
      case 'THINKING':
        return 'Processing';
      case 'PAUSED':
        return 'Paused';
      case 'ERROR':
        return 'Error';
      default:
        return '';
    }
  };

  const getStateColor = (currentState: TeacherState): string => {
    switch (currentState) {
      case 'IDLE':
        return Colors.muted;
      case 'PARSING_DOC':
        return Colors.primary;
      case 'AI_SPEAKING':
        return Colors.primary;
      case 'LISTENING':
        return '#F472B6'; // AI active pink
      case 'THINKING':
        return Colors.primary;
      case 'PAUSED':
        return Colors.muted;
      case 'ERROR':
        return '#EF4444'; // Error red
      default:
        return Colors.muted;
    }
  };

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.indicatorDot, { backgroundColor: getStateColor(state) }]} />
      <Text style={[styles.statusText, { color: getStateColor(state) }]}>
        {getStateText(state)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  statusText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
