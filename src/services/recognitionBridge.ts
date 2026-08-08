/**
 * recognitionBridge.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal pub/sub channel so TTS completion can request the speech recognizer
 * to start listening. Used by the AI Teacher push-to-talk flow: when an
 * onboarding/status prompt finishes speaking while the user is still holding
 * the surface, the recognizer re-arms itself instead of waiting for a fresh
 * press.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type StartListener = () => void;

const listeners = new Set<StartListener>();

export const recognitionBridge = {
  subscribe(listener: StartListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  notifyTtsFinished(): void {
    listeners.forEach((listener) => listener());
  },
};
