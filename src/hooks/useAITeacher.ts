/**
 * useAITeacher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Core hook for AI Interactive Teacher Mode
 *
 * Provides a clean interface for UI components to interact with the FSM,
 * voice flow, and accessibility features.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import { useTeacherContext } from '../context/TeacherContext';
import { useVoiceRecognition, type LiveVoiceCommand } from './useVoiceRecognition';
import { useTextToSpeech } from './useTextToSpeech';
import { dataHubService } from '../services/DataHubService';
import { recognitionBridge } from '../services/recognitionBridge';
import { modeBridge } from '../services/modeBridge';
import type { PageRange, TeacherState } from '../types/teacher.types';

export interface UseAITeacherReturn {
  // State
  state: TeacherState;
  isReady: boolean;
  isLoading: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  currentDocument: any;
  metadata: any;
  currentPage: number;
  pendingTeachPage: number | null;
  statusMessage: string;
  recognizedText: string;
  onboardingStep: number;

  // Actions
  loadDocument: (uri: string) => Promise<void>;
  startReading: (range: PageRange) => Promise<void>;
  pauseReading: () => Promise<void>;
  resumeReading: () => Promise<void>;
  activateListening: () => Promise<void>;
  askQuestion: (question: string) => Promise<void>;
  cancelListening: () => Promise<void>;
  handleTouchDown: () => Promise<void>;
  handleTouchUp: () => Promise<void>;
  submitTextCommand: (text: string) => Promise<void>;
  startOnboarding: () => Promise<void>;

  // Utilities
  parseVoiceCommand: (command: string) => PageRange | null;
  verifyContent: (text: string) => boolean;
  getAccessibilityLabel: () => string;
}

/**
 * Main hook for AI Teacher Mode functionality
 */
export function useAITeacher(): UseAITeacherReturn {
  const context = useTeacherContext();
  const voiceRecognition = useVoiceRecognition();
  const textToSpeech = useTextToSpeech();
  
  const [statusMessage, setStatusMessage] = useState('Ready to study');
  const isHoldingRef = useRef(false);
  const autoListenRef = useRef(false);
  // Set when an instant keyword command (next/back/repeat) already performed
  // page navigation, so the matching push-to-talk release does not re-run it.
  const liveCommandHandledRef = useRef(false);

  /**
   * Hands-free capture: a recognized final transcript arrives straight from
   * the recognizer (no push-to-talk press). The mic is ALWAYS closed before
   * the teacher speaks — otherwise the AI's own voice could be re-captured as
   * a phantom command — then the command routes through the same FSM pipeline
   * as a spoken PTT command, and the loop re-arms on the response.
   */
  const handleAutoCapture = useCallback(async (text: string) => {
    if (!autoListenRef.current) return;
    autoListenRef.current = false;
    try {
      // Echo guard: never route a transcript captured while the AI is still
      // speaking out loud — it is the AI's own voice echoing into the mic.
      if (await Speech.isSpeakingAsync()) {
        console.log('[useAITeacher] Ignoring auto-capture while TTS is active');
        return;
      }
      // Close the mic (returns the latest transcript) before routing so the
      // response speech is never captured back into the recognizer.
      const spoken = await voiceRecognition.stopListening();
      await context.handleTouchUp(text || spoken || '');
    } catch (error) {
      console.error('[useAITeacher] Auto capture error:', error);
    }
  }, [context, voiceRecognition]);

  /**
   * Instant keyword commands: fired by the recognizer the moment a live
   * transcript (interim or final) contains a keyword, so the action never
   * waits for the speech session to end. Page-navigation commands reuse the
   * FSM command router; mode-switch commands are handed to the top-level mode
   * bridge, which swaps screens, isolates audio, and speaks the new mode.
   * Greetings forward the full spoken sentence so the teacher engine can give
   * a warm response instead of treating "hello" as a question.
   */
  const handleLiveCommand = useCallback(async (command: LiveVoiceCommand, transcript: string) => {
    liveCommandHandledRef.current = true;
    console.log(`[useAITeacher] Live command: ${command} ("${transcript}")`);
    if (command === 'player' || command === 'teacher') {
      modeBridge.requestMode(command);
      return;
    }
    try {
      // Instant "stop" / "pause" / "wait": cancel all active speech right away,
      // move to a paused state, then acknowledge and re-arm the mic hands-free.
      if (command === 'pause') {
        await context.pauseAndConfirm();
      } else {
        // Navigation / start / greeting commands route through the same FSM
        // pipeline as a spoken PTT command, which speaks the confirmation.
        await context.submitTextCommand(command === 'greeting' ? transcript : command);
      }
      // The command completed: clear the transcript so the UI overlay and live
      // region never stay stuck showing the consumed command.
      voiceRecognition.resetRecognizedText();
    } catch (error) {
      console.error('[useAITeacher] Live command error:', error);
      voiceRecognition.resetRecognizedText();
    }
  }, [context, voiceRecognition]);

  // Speak-then-listen accessibility loop:
  //  - 'autoListen': greeting / page reading / command response finished ->
  //    re-arm the mic hands-free.
  //  - 'ttsFinished': a prompt finished while the user is still holding the
  //    push-to-talk surface -> re-arm the mic for the held press.
  useEffect(() => {
    return recognitionBridge.subscribe((reason) => {
      if (reason === 'autoListen') {
        autoListenRef.current = true;
        liveCommandHandledRef.current = false;
        void voiceRecognition.startListening({
          onFinalResult: handleAutoCapture,
          onLiveCommand: handleLiveCommand,
        });
      } else if (reason === 'ttsFinished') {
        if (isHoldingRef.current) {
          liveCommandHandledRef.current = false;
          void voiceRecognition.startListening({ onLiveCommand: handleLiveCommand });
        }
      }
    });
  }, [voiceRecognition, handleAutoCapture, handleLiveCommand]);

  // Sync status messages with FSM state
  useEffect(() => {
    switch (context.state) {
      case 'IDLE':
        setStatusMessage('Tap anywhere to begin your lesson');
        break;
      case 'ONBOARDING':
        setStatusMessage(`Onboarding Step ${context.onboardingStep}`);
        break;
      case 'AI_SPEAKING':
        setStatusMessage(
          context.pendingTeachPage != null
            ? `Awaiting confirmation before explaining page ${context.pendingTeachPage}`
            : `Teaching page ${context.currentPage}`
        );
        break;
      case 'LISTENING':
        setStatusMessage(
          context.pendingTeachPage != null
            ? `Listening... say yes to begin page ${context.pendingTeachPage}`
            : 'Listening...'
        );
        break;
      case 'THINKING':
        setStatusMessage('Processing...');
        break;
      case 'PAUSED':
        setStatusMessage('Paused. Say a command or topic to continue');
        break;
      case 'ERROR':
        setStatusMessage('An error occurred');
        break;
    }
  }, [context.state, context.onboardingStep, context.currentPage, context.pendingTeachPage]);

  /**
   * Handle touch down - activate voice recognition or start onboarding
   */
  const handleTouchDown = useCallback(async () => {
    try {
      isHoldingRef.current = true;
      liveCommandHandledRef.current = false;
      const shouldListen = await context.handleTouchDown();
      if (shouldListen) {
        // Let hardPause finish stopping TTS before the mic opens (audio focus).
        await new Promise((resolve) => setTimeout(resolve, 150));
        await voiceRecognition.startListening({ onLiveCommand: handleLiveCommand });
      }
    } catch (error) {
      console.error('[useAITeacher] Touch down error:', error);
    }
  }, [context, voiceRecognition, handleLiveCommand]);

  /**
   * Handle touch up - process recognized speech
   */
  const handleTouchUp = useCallback(async () => {
    try {
      isHoldingRef.current = false;
      // A live keyword command already performed the navigation, so this
      // release must not re-run the same command.
      if (liveCommandHandledRef.current) {
        liveCommandHandledRef.current = false;
        return;
      }
      const text = await voiceRecognition.stopListening();

      // Pass the text to context for FSM processing (onboarding or commands)
      await context.handleTouchUp(text || '');
    } catch (error) {
      console.error('[useAITeacher] Touch up error:', error);
    }
  }, [context, voiceRecognition]);

  return {
    state: context.state,
    isReady: context.state === 'IDLE' || context.state === 'PAUSED',
    isLoading: context.state === 'THINKING' || context.state === 'PARSING_DOC',
    isListening: context.state === 'LISTENING',
    isSpeaking: textToSpeech.isSpeaking,
    currentDocument: context.document,
    metadata: context.metadata,
    currentPage: context.currentPage,
    pendingTeachPage: context.pendingTeachPage,
    onboardingStep: context.onboardingStep,
    statusMessage,
    recognizedText: voiceRecognition.recognizedText,
    
    loadDocument: context.loadDocument,
    startReading: context.startReading,
    pauseReading: context.pauseReading,
    resumeReading: context.resumeReading,
    activateListening: context.activateListening,
    askQuestion: context.askQuestion,
    cancelListening: context.cancelListening,
    handleTouchDown,
    handleTouchUp,
    submitTextCommand: context.submitTextCommand,
    startOnboarding: context.startOnboarding,

    parseVoiceCommand: (command: string) => null, // Simplified for now
    verifyContent: (text: string) => {
      if (!context.metadata || !context.currentPage) return false;
      return dataHubService.verifyStructuralContext(context.metadata, context.currentPage, text);
    },
    getAccessibilityLabel: () => {
      if (context.state === 'ONBOARDING') return `Step ${context.onboardingStep} of setup. Speak clearly after tapping.`;
      return statusMessage;
    },
  };
}
