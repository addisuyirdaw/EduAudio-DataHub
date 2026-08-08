/**
 * useKeyboardPTT.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Global keyboard Push-To-Talk listener (web builds).
 *
 * Lets a blind student press and hold the Spacebar (or the M key) anywhere in
 * the app to activate voice input without needing a mouse or touch. Key events
 * are ignored while a text field (the fallback command input) is focused so
 * typing spaces doesn't trigger the mic.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const PTT_KEYS = new Set(['Space', 'KeyM']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Attach global Spacebar / M key listeners that map press/hold to the
 * push-to-talk onPressIn / onPressOut callbacks. When `enabled` is false the
 * listeners are detached (used to keep the audio-player tab hotkey from
 * colliding with the AI Teacher screen's own push-to-talk).
 */
export function useKeyboardPTT(
  onPressIn: () => void,
  onPressOut: () => void,
  enabled: boolean = true
): void {
  const onPressInRef = useRef(onPressIn);
  const onPressOutRef = useRef(onPressOut);
  onPressInRef.current = onPressIn;
  onPressOutRef.current = onPressOut;

  const heldKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!PTT_KEYS.has(event.code)) return;
      if (isEditableTarget(event.target)) return;
      if (event.repeat) return;
      if (heldKeyRef.current) return;

      // Prevent Space from scrolling the page while used for PTT.
      event.preventDefault();
      heldKeyRef.current = event.code;
      onPressInRef.current();
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!PTT_KEYS.has(event.code)) return;
      if (heldKeyRef.current !== event.code) return;
      heldKeyRef.current = null;
      onPressOutRef.current();
    };

    const handleWindowBlur = (): void => {
      if (heldKeyRef.current) {
        heldKeyRef.current = null;
        onPressOutRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [enabled]);
}
