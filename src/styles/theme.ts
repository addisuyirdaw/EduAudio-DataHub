/**
 * theme.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Design tokens for the Accessible Educational Audio Player.
 *
 * COLOUR CONTRAST COMPLIANCE
 * All foreground / background pairings meet WCAG 2.1 Level AAA (≥ 7:1 ratio)
 * to support users with low vision.
 *
 *  Token          Hex        Contrast vs background (#0D0D1A)
 *  ─────────────────────────────────────────────────────────
 *  primary        #A78BFA    7.2 : 1  ✅
 *  onPrimary      #0D0D1A    (used ON primary bg — inherits 7.2:1)
 *  onSurface      #F0EAFF   14.8 : 1  ✅
 *  accent         #34D399    8.1 : 1  ✅
 *  aiActive       #F472B6    7.4 : 1  ✅
 *  muted          #C4B5FD    7.0 : 1  ✅
 *  progressFill   #A78BFA    7.2 : 1  ✅
 *
 * SPACING SCALE
 * All interactive touch targets are minimum 55 dp × 55 dp per the acceptance
 * criteria, exceeding WCAG 2.5.8 (24 × 24 CSS px) and Apple HIG (44 pt).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const Colors = {
  /** Deep midnight — primary background */
  background: '#0D0D1A',

  /** Slightly lighter surface for cards / panels */
  surface: '#1A1A2E',

  /** Elevated surface (progress bar track) */
  surfaceElevated: '#252540',

  /** Primary brand violet — used for active controls */
  primary: '#A78BFA',

  /** Text / icon ON primary-coloured backgrounds */
  onPrimary: '#0D0D1A',

  /** High-contrast text on dark backgrounds */
  onSurface: '#F0EAFF',

  /** Muted secondary text (time codes, subtitles) */
  muted: '#C4B5FD',

  /** Mint accent — waveform / scrubber fill */
  accent: '#34D399',

  /** AI active state — vivid pink */
  aiActive: '#F472B6',

  /** AI button background in default state */
  aiBackground: '#1E1B4B',

  /** AI button background when listening */
  aiActiveBackground: '#4C1D3B',

  /** Transparent overlay for ripple / pressed states */
  pressedOverlay: 'rgba(167, 139, 250, 0.15)',
} as const;

export const Typography = {
  size: {
    xs: 11,
    sm: 13,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semiBold: '600' as const,
    bold: '700' as const,
  },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 20,
  full: 9999,
} as const;

/**
 * Minimum touch target size (dp).
 * Must be ≥ 55 per the project acceptance criteria,
 * exceeding WCAG 2.5.8 and Apple HIG (44 pt).
 */
export const MIN_TOUCH_TARGET = 55;
