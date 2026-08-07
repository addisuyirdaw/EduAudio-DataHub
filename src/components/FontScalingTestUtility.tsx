/**
 * FontScalingTestUtility.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Visual Test Utility for Font Scaling QA
 * 
 * Simulates 100%, 200%, and 300% font scaling within Expo Go for manual QA.
 * Allows developers to test adaptive layout behavior without changing system settings.
 * 
 * Usage:
 * - Wrap your component with this utility during development
 * - Toggle between font scale presets using the buttons
 * - Observe how the layout adapts and prevents text clipping
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { createContext, useContext, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Colors, Spacing } from '../styles/theme';

interface FontScaleContextType {
  simulatedFontScale: number;
  setSimulatedFontScale: (scale: number) => void;
}

const FontScaleContext = createContext<FontScaleContextType | undefined>(undefined);

interface FontScalingTestUtilityProps {
  children: React.ReactNode;
  enabled?: boolean;
}

export const FontScalingTestUtility: React.FC<FontScalingTestUtilityProps> = ({
  children,
  enabled = true,
}) => {
  const [simulatedFontScale, setSimulatedFontScale] = useState(1.0);
  const [showControls, setShowControls] = useState(true);

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <FontScaleContext.Provider value={{ simulatedFontScale, setSimulatedFontScale }}>
      <View style={styles.container}>
        {children}
        
        {/* Test Controls Overlay */}
        {showControls && (
          <View style={styles.controlsOverlay}>
            <Pressable
              onPress={() => setShowControls(false)}
              style={styles.closeButton}
              accessible={true}
              accessibilityLabel="Close test controls"
              accessibilityRole="button"
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
            
            <View style={styles.controlsContent}>
              <Text style={styles.controlsTitle}>Font Scaling Test Utility</Text>
              <Text style={styles.controlsSubtitle}>
                Current Scale: {simulatedFontScale}x
              </Text>
              
              <View style={styles.buttonRow}>
                <Pressable
                  onPress={() => setSimulatedFontScale(1.0)}
                  style={[
                    styles.scaleButton,
                    simulatedFontScale === 1.0 && styles.scaleButtonActive,
                  ]}
                  accessible={true}
                  accessibilityLabel="Simulate 100% font scale"
                  accessibilityRole="button"
                  accessibilityState={{ selected: simulatedFontScale === 1.0 }}
                >
                  <Text style={[
                    styles.scaleButtonText,
                    simulatedFontScale === 1.0 && styles.scaleButtonTextActive,
                  ]}>
                    100%
                  </Text>
                </Pressable>
                
                <Pressable
                  onPress={() => setSimulatedFontScale(2.0)}
                  style={[
                    styles.scaleButton,
                    simulatedFontScale === 2.0 && styles.scaleButtonActive,
                  ]}
                  accessible={true}
                  accessibilityLabel="Simulate 200% font scale"
                  accessibilityRole="button"
                  accessibilityState={{ selected: simulatedFontScale === 2.0 }}
                >
                  <Text style={[
                    styles.scaleButtonText,
                    simulatedFontScale === 2.0 && styles.scaleButtonTextActive,
                  ]}>
                    200%
                  </Text>
                </Pressable>
                
                <Pressable
                  onPress={() => setSimulatedFontScale(3.0)}
                  style={[
                    styles.scaleButton,
                    simulatedFontScale === 3.0 && styles.scaleButtonActive,
                  ]}
                  accessible={true}
                  accessibilityLabel="Simulate 300% font scale"
                  accessibilityRole="button"
                  accessibilityState={{ selected: simulatedFontScale === 3.0 }}
                >
                  <Text style={[
                    styles.scaleButtonText,
                    simulatedFontScale === 3.0 && styles.scaleButtonTextActive,
                  ]}>
                    300%
                  </Text>
                </Pressable>
              </View>
              
              <Text style={styles.infoText}>
                {simulatedFontScale >= 2.0 ? (
                  '⚠️ High scaling: Header and HUD zones should become scrollable'
                ) : (
                  '✓ Normal scaling: Fixed percentage zones'
                )}
              </Text>
            </View>
          </View>
        )}
        
        {/* Re-open button when controls are hidden */}
        {!showControls && (
          <Pressable
            onPress={() => setShowControls(true)}
            style={styles.reopenButton}
            accessible={true}
            accessibilityLabel="Open font scaling test controls"
            accessibilityRole="button"
          >
            <Text style={styles.reopenText}>🔧</Text>
          </Pressable>
        )}
      </View>
    </FontScaleContext.Provider>
  );
};

/**
 * Hook to access simulated font scale in child components
 */
export const useSimulatedFontScale = () => {
  const context = useContext(FontScaleContext);
  if (!context) {
    // Return real font scale if not in test mode
    return { simulatedFontScale: 1.0, setSimulatedFontScale: () => {} };
  }
  return context;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  controlsOverlay: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 50 : 20,
    right: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceElevated,
    padding: 16,
    minWidth: 280,
    shadowColor: Colors.background,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: Colors.onSurface,
    fontSize: 14,
    fontWeight: '600',
  },
  controlsContent: {
    paddingTop: 8,
  },
  controlsTitle: {
    color: Colors.onSurface,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  controlsSubtitle: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  scaleButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.surfaceElevated,
    alignItems: 'center',
  },
  scaleButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  scaleButtonText: {
    color: Colors.onSurface,
    fontSize: 12,
    fontWeight: '600',
  },
  scaleButtonTextActive: {
    color: Colors.onPrimary,
  },
  infoText: {
    color: Colors.muted,
    fontSize: 10,
    lineHeight: 14,
  },
  reopenButton: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 50 : 20,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.background,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 999,
  },
  reopenText: {
    fontSize: 20,
  },
});
