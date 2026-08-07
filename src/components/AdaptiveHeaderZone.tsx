/**
 * AdaptiveHeaderZone.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Adaptive Header Zone Component
 * 
 * Automatically transitions between fixed height and scrollable layout
 * based on font scaling to prevent text clipping at 200%+ system font scaling.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Colors, Spacing } from '../styles/theme';
import type { AdaptiveLayoutConfig } from '../hooks/useAdaptiveLayout';

interface AdaptiveHeaderZoneProps {
  config: AdaptiveLayoutConfig;
  courseTitle: string;
  chapterTitle: string;
  instructorName: string;
}

export const AdaptiveHeaderZone: React.FC<AdaptiveHeaderZoneProps> = ({
  config,
  courseTitle,
  chapterTitle,
  instructorName,
}) => {
  const { headerZone, textMultiplier } = config;

  const Content = () => (
    <View
      accessible={true}
      accessibilityRole="header"
      accessibilityLabel={`Course: ${courseTitle}. Chapter: ${chapterTitle} by ${instructorName}`}
      style={styles.headerContent}
    >
      <Text style={[styles.courseTitle, { fontSize: 14 * textMultiplier }]}>
        {courseTitle}
      </Text>
      <Text style={[styles.chapterTitle, { fontSize: 24 * textMultiplier }]}>
        {chapterTitle}
      </Text>
      <Text style={[styles.instructorName, { fontSize: 16 * textMultiplier }]}>
        {instructorName}
      </Text>
    </View>
  );

  if (headerZone.scrollable) {
    return (
      <ScrollView
        style={[styles.headerZone, { flex: headerZone.flex, minHeight: headerZone.minHeight }]}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled={true}
        showsVerticalScrollIndicator={false}
      >
        <Content />
      </ScrollView>
    );
  }

  return (
    <View style={[styles.headerZone, { flex: headerZone.flex }]}>
      <Content />
    </View>
  );
};

const styles = StyleSheet.create({
  headerZone: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  headerContent: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  courseTitle: {
    color: Colors.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  chapterTitle: {
    color: Colors.onSurface,
    fontWeight: '700',
    lineHeight: 32,
    marginBottom: 4,
  },
  instructorName: {
    color: Colors.muted,
    fontWeight: '500',
  },
});
