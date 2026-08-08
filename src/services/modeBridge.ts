/**
 * modeBridge.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal pub/sub channel for mode-switch requests (Audio Player <-> AI
 * Teacher) that originate deep in the voice/command stack.
 *
 * The AI Teacher's live keyword matcher and command router live far below the
 * top-level mode state in App.tsx. This bridge carries "switch to player /
 * switch to teacher" requests up to App, which performs the actual mode swap,
 * audio isolation (hardPause), and spoken announcement.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ModeRequest = 'player' | 'teacher';

type ModeListener = (mode: ModeRequest) => void;

const listeners = new Set<ModeListener>();

export const modeBridge = {
  subscribe(listener: ModeListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  requestMode(mode: ModeRequest): void {
    listeners.forEach((listener) => {
      try {
        listener(mode);
      } catch (error) {
        console.error('[modeBridge] Mode listener error:', error);
      }
    });
  },
};
