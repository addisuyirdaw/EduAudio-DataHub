/**
 * recognitionBridge.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal pub/sub channel between TTS completion / FSM events and the speech
 * recognizer.
 *
 * Used by the AI Teacher push-to-talk flow:
 *  - 'ttsFinished': a prompt finished while the user is still holding the
 *    push-to-talk surface, so the recognizer re-arms itself.
 *  - 'autoListen':  the speak-then-listen accessibility loop wants the mic
 *    re-armed hands-free (greeting finished, a page finished reading, or a
 *    spoken navigation command was just answered).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type RecognitionBridgeReason = 'ttsFinished' | 'autoListen';

type BridgeListener = (reason: RecognitionBridgeReason) => void;

const listeners = new Set<BridgeListener>();

function emit(reason: RecognitionBridgeReason): void {
  listeners.forEach((listener) => listener(reason));
}

export const recognitionBridge = {
  subscribe(listener: BridgeListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  notifyTtsFinished(): void {
    emit('ttsFinished');
  },
  notifyAutoListen(): void {
    emit('autoListen');
  },
};
