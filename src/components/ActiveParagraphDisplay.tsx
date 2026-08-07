/**
 * ActiveParagraphDisplay.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Active Paragraph Display Component
 * 
 * Displays the current reading content with large, high-contrast typography.
 * WCAG 2.2 AAA compliant with minimum 7:1 contrast ratio.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTeacherContext } from '../context/TeacherContext';
import { Colors, Typography, Spacing } from '../styles/theme';

export const ActiveParagraphDisplay: React.FC = () => {
  const { document, currentPage } = useTeacherContext();

  // Get current page text
  const currentText = document?.pages[currentPage - 1]?.text || 'No document loaded';

  return (
    <View style={styles.container}>
      {/* Page indicator */}
      <View style={styles.pageIndicator}>
        <Text style={styles.pageIndicatorText}>
          Page {currentPage} of {document?.totalPages || 0}
        </Text>
      </View>

      {/* Active paragraph text */}
      <View style={styles.textContainer}>
        <Text style={styles.text} numberOfLines={10}>
          {currentText}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  pageIndicator: {
    marginBottom: Spacing.md,
  },
  pageIndicatorText: {
    color: Colors.muted,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  text: {
    color: Colors.onSurface,
    fontSize: Typography.size.xl,
    lineHeight: 32,
    fontWeight: Typography.weight.medium,
    textAlign: 'left',
  },
});
