/**
 * useAdaptiveLayout.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Adaptive Layout Hook for WCAG 2.2 AAA Font Scaling Support
 * 
 * Dynamically adapts layout zones based on system font scaling.
 * Transitions from fixed percentage zones to flexible scrollable layouts
 * when font scaling exceeds 200% to prevent text clipping.
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from 'react';
import { useWindowDimensions, PixelRatio } from 'react-native';

export interface AdaptiveLayoutConfig {
  fontScale: number;
  isHighScaling: boolean; // true when fontScale >= 2.0
  isVeryHighScaling: boolean; // true when fontScale >= 2.5
  isExtremeScaling: boolean; // true when fontScale >= 3.0
  
  // Zone configurations
  headerZone: {
    flex: number;
    scrollable: boolean;
    minHeight?: number;
  };
  readingViewport: {
    flex: number;
    scrollable: boolean;
  };
  mediaControlZone: {
    flex: number;
    minHeight: number; // Ensures touch targets fit
  };
  hudZone: {
    flex: number;
    scrollable: boolean;
    minHeight?: number;
  };
  
  // Touch target adjustments
  playButtonSize: number;
  skipButtonSize: number;
  
  // Text size multipliers
  textMultiplier: number;
}

const HIGH_SCALING_THRESHOLD = 2.0;
const VERY_HIGH_SCALING_THRESHOLD = 2.5;
const EXTREME_SCALING_THRESHOLD = 3.0;

const BASE_TOUCH_TARGET_PLAY = 72; // 72x72dp
const BASE_TOUCH_TARGET_SKIP = 56; // 56x56dp

export const useAdaptiveLayout = (): AdaptiveLayoutConfig => {
  const { width, height } = useWindowDimensions();
  const [fontScale, setFontScale] = useState(PixelRatio.getFontScale());
  
  useEffect(() => {
    // Listen for font scale changes (e.g., when user changes system settings)
    const updateFontScale = () => {
      setFontScale(PixelRatio.getFontScale());
    };
    
    // In a real app, you might use a listener or polling
    // For now, we'll check periodically
    const interval = setInterval(updateFontScale, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  const isHighScaling = fontScale >= HIGH_SCALING_THRESHOLD;
  const isVeryHighScaling = fontScale >= VERY_HIGH_SCALING_THRESHOLD;
  const isExtremeScaling = fontScale >= EXTREME_SCALING_THRESHOLD;
  
  // Calculate adaptive zone configurations
  const headerZone: AdaptiveLayoutConfig['headerZone'] = {
    flex: isHighScaling ? 0 : 0.15,
    scrollable: isHighScaling,
    minHeight: isHighScaling ? 80 : undefined,
  };
  
  const readingViewport: AdaptiveLayoutConfig['readingViewport'] = {
    flex: isHighScaling ? 1 : 0.45,
    scrollable: true, // Always scrollable for reading content
  };
  
  const mediaControlZone: AdaptiveLayoutConfig['mediaControlZone'] = {
    flex: isHighScaling ? 0 : 0.20,
    minHeight: isHighScaling ? 120 : 0, // Ensure touch targets fit
  };
  
  const hudZone: AdaptiveLayoutConfig['hudZone'] = {
    flex: isHighScaling ? 0 : 0.20,
    scrollable: isHighScaling,
    minHeight: isHighScaling ? 80 : undefined,
  };
  
  // Adjust touch targets based on scaling (maintain minimum sizes)
  const playButtonSize = Math.max(BASE_TOUCH_TARGET_PLAY, BASE_TOUCH_TARGET_PLAY * fontScale * 0.8);
  const skipButtonSize = Math.max(BASE_TOUCH_TARGET_SKIP, BASE_TOUCH_TARGET_SKIP * fontScale * 0.8);
  
  // Text multiplier for dynamic typography
  const textMultiplier = 1 / fontScale;
  
  return {
    fontScale,
    isHighScaling,
    isVeryHighScaling,
    isExtremeScaling,
    headerZone,
    readingViewport,
    mediaControlZone,
    hudZone,
    playButtonSize,
    skipButtonSize,
    textMultiplier,
  };
};
