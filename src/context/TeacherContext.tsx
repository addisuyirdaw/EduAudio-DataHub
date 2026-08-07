/**
 * TeacherContext.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Teacher Context with Finite State Machine (FSM)
 * 
 * Manages the global state for the AI Interactive Teacher Mode including:
 * - State machine transitions (IDLE, PARSING_DOC, AI_SPEAKING, LISTENING, THINKING, PAUSED, ERROR)
 * - Document loading and parsing
 * - Playback control
 * - Voice interaction management
 * - Onboarding flow (Subject -> Unit -> Topic)
 * - Environment awareness for API keys
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import * as Speech from 'expo-speech';
import type { TeacherState, TeacherContext, ParsedDocument, PageRange, ConversationMessage, InterruptionContext, AudioMutexState } from '../types/teacher.types';
import { EducationalMetadata, dataHubService } from '../services/DataHubService';
import { audioMutex } from './AudioMutex';
import { voiceCommandParser, ParsedVoiceCommand } from '../services/voiceCommandParser.service';

interface TeacherContextProviderProps {
  children: React.ReactNode;
}

const TeacherContext = createContext<TeacherContext | null>(null);

const TTS_CONFIG: Speech.SpeechOptions = {
  language: 'en-US',
  pitch: 1.0,
  rate: 0.9, // Slightly slower for better clarity
};

/**
 * Teacher Context Provider
 * Implements the FSM and provides actions for state transitions
 */
export const TeacherProvider: React.FC<TeacherContextProviderProps> = ({ children }) => {
  // FSM State
  const [state, setState] = useState<TeacherState>('IDLE');
  const [document, setDocument] = useState<ParsedDocument | null>(null);
  const [metadata, setMetadata] = useState<EducationalMetadata | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [interruptionContext, setInterruptionContext] = useState<InterruptionContext | null>(null);
  const [audioMutexState, setAudioMutexState] = useState<AudioMutexState>(audioMutex.getState());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Refs for async operations
  const stateTransitionRef = useRef<TeacherState>('IDLE');
  const isTransitioningRef = useRef(false);

  // Subscribe to audio mutex state changes
  useEffect(() => {
    const unsubscribe = audioMutex.onStateChange((newState) => {
      setAudioMutexState(newState);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  /**
   * Safe TTS execution wrapper
   */
  const speakSilently = useCallback(async (text: string, options?: Speech.SpeechOptions) => {
    try {
      await audioMutex.acquireTTSLock();
      console.log(`[TeacherContext] Speaking: ${text.substring(0, 50)}...`);

      Speech.speak(text, {
        ...TTS_CONFIG,
        ...options,
        onDone: () => {
          void (async () => {
            await audioMutex.releaseTTSLock();
            options?.onDone?.();
          })();
        },
        onError: (error) => {
          void (async () => {
            console.error('[TeacherContext] Speech error:', error);
            await audioMutex.releaseTTSLock();
            options?.onError?.(error);
          })();
        },
        onStopped: () => {
          void (async () => {
            await audioMutex.releaseTTSLock();
          })();
        }
      });
    } catch (err) {
      console.error('[TeacherContext] TTS speak failed:', err);
      await audioMutex.releaseTTSLock();
    }
  }, []);

  /**
   * State transition helper with validation
   */
  const transitionState = useCallback((newState: TeacherState, fromState?: TeacherState) => {
    if (isTransitioningRef.current) {
      console.warn(`[TeacherContext] State transition already in progress, ignoring ${stateTransitionRef.current} → ${newState}`);
      return false;
    }

    if (fromState && stateTransitionRef.current !== fromState) {
      console.warn(`[TeacherContext] Invalid state transition: expected ${fromState}, got ${stateTransitionRef.current}`);
      return false;
    }

    console.log(`[TeacherContext] State transition: ${stateTransitionRef.current} → ${newState}`);
    isTransitioningRef.current = true;
    stateTransitionRef.current = newState;
    setState(newState);
    isTransitioningRef.current = false;
    return true;
  }, []);

  /**
   * Start Onboarding Flow
   */
  const startOnboarding = useCallback(async () => {
    transitionState('ONBOARDING');
    setOnboardingStep(1);
    await speakSilently("Welcome to Edu Audio! What subject would you like to study today?");
  }, [transitionState, speakSilently]);

  /**
   * Load a document and begin parsing
   */
  const loadDocument = useCallback(async (uri: string): Promise<void> => {
    if (!transitionState('PARSING_DOC')) {
      throw new Error('Cannot load document: invalid state transition');
    }

    try {
      // Simulation of PDF parsing
      const mockDocument: ParsedDocument = {
        id: `doc_${Date.now()}`,
        title: 'Quantum Mechanics 101',
        uri,
        totalPages: 22,
        pages: [], // Actual content would be populated here
        metadata: {},
      };

      setDocument(mockDocument);

      // Fetch Educational Metadata
      try {
        const docMetadata = await dataHubService.fetchMetadata(mockDocument.id);
        setMetadata(docMetadata);
      } catch (metaError) {
        console.warn('[TeacherContext] Metadata fetch failed, using fallback', metaError);
      }

      setCurrentPage(1);
      transitionState('PAUSED');
      await speakSilently("Document loaded and verified. I'm ready when you are.");
    } catch (error) {
      console.error('[TeacherContext] Document loading failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load document');
      transitionState('ERROR');
    }
  }, [transitionState, speakSilently]);

  /**
   * Start reading a specific page range
   */
  const startReading = useCallback(async (range: PageRange): Promise<void> => {
    transitionState('AI_SPEAKING');
    setCurrentPage(range.startPage);
    // Actual TTS implementation would loop through paragraphs here
  }, [transitionState]);

  const pauseReading = useCallback(async (): Promise<void> => {
    transitionState('PAUSED', 'AI_SPEAKING');
    await Speech.stop();
    await audioMutex.releaseTTSLock();
  }, [transitionState]);

  const resumeReading = useCallback(async (): Promise<void> => {
    transitionState('AI_SPEAKING', 'PAUSED');
    // Actual TTS implementation would resume here
  }, [transitionState]);

  const activateListening = useCallback(async (): Promise<void> => {
    transitionState('LISTENING');
    await audioMutex.acquireRecordingLock();
  }, [transitionState]);

  /**
   * Ask a question (LLM Integration with Safe API Key Check)
   */
  const askQuestion = useCallback(async (question: string): Promise<void> => {
    transitionState('THINKING', 'LISTENING');
    await audioMutex.releaseRecordingLock();

    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

    // Check for API Key presence
    if (!apiKey || apiKey.trim() === "") {
      console.warn("[TeacherContext] Gemini API key is missing. Using local fallback.");
      // Updated fallback response to be more user-friendly for students
      const fallbackResponse = "I am currently running in offline mode. I can still help you read your document, but my advanced questioning features are limited. We are on page " + currentPage;
      await speakSilently(fallbackResponse, {
        onDone: () => { transitionState('PAUSED'); }
      });
      return;
    }

    try {
      // Simulate LLM Processing
      await new Promise(resolve => setTimeout(resolve, 1500));
      const responseText = `Regarding your question about ${question}, the document mentions that wave-particle duality is a fundamental concept in quantum mechanics.`;
      
      await speakSilently(responseText, {
        onDone: () => { transitionState('PAUSED'); }
      });
    } catch (error) {
      console.error("[TeacherContext] AI Query failed:", error);
      await speakSilently("I encountered an error processing that question. Let's get back to the reading.", {
        onDone: () => { transitionState('PAUSED'); }
      });
    }
  }, [transitionState, speakSilently, currentPage]);

  const cancelListening = useCallback(async (): Promise<void> => {
    transitionState('PAUSED', 'LISTENING');
    await audioMutex.releaseRecordingLock();
  }, [transitionState]);

  const clearError = useCallback(() => {
    transitionState('IDLE', 'ERROR');
    setErrorMessage(null);
  }, [transitionState]);

  /**
   * Handle touch down
   */
  const handleTouchDown = useCallback(async (): Promise<void> => {
    if (state === 'IDLE') {
      await startOnboarding();
      return;
    }

    await audioMutex.hardPause();
    transitionState('LISTENING');
    await audioMutex.acquireRecordingLock();
  }, [state, transitionState, startOnboarding]);

  /**
   * Handle touch up - Main voice logic
   */
  const handleTouchUp = useCallback(async (recognizedText: string): Promise<void> => {
    if (state === 'ONBOARDING') {
      await audioMutex.releaseRecordingLock();

      if (onboardingStep === 1) {
        setOnboardingStep(2);
        await speakSilently(`Got it! Studying ${recognizedText} today. Which unit or chapter are we working on?`);
      } else if (onboardingStep === 2) {
        setOnboardingStep(3);
        await speakSilently(`Okay, chapter ${recognizedText}. Which specific topic should we cover?`);
      } else if (onboardingStep === 3) {
        setOnboardingStep(0);
        transitionState('THINKING');
        await speakSilently("One moment while I fetch the lesson metadata and verify the content.");

        // Fetch Metadata & Verify
        try {
          const topicId = recognizedText.toLowerCase().replace(/\s+/g, '-');
          const docMetadata = await dataHubService.fetchMetadata(topicId);
          setMetadata(docMetadata);

          if (docMetadata) {
            await speakSilently(`Verified. I've loaded the outline for ${docMetadata.documentId}. Starting lesson now.`);
            // Transition to actual reading
            setDocument({ id: topicId, title: recognizedText, totalPages: 10, pages: [], metadata: {}, uri: '' });
            setCurrentPage(1);
            transitionState('AI_SPEAKING');
          }
        } catch (e) {
          console.warn("Metadata verification failed, falling back to basic reading.");
          transitionState('PAUSED');
        }
      }
      return;
    }

    if (state === 'LISTENING') {
      await audioMutex.releaseRecordingLock();
      const { action, offlineMessage } = await voiceCommandParser.processCommand(recognizedText);

      if (offlineMessage) {
        await speakSilently(offlineMessage, { onDone: () => { transitionState('PAUSED'); } });
        return;
      }

      // Route commands
      if (action.type === 'AI_QUERY') {
        await askQuestion(recognizedText);
      } else {
        // Handle local navigation commands...
        transitionState('PAUSED');
      }
    }
  }, [state, onboardingStep, transitionState, speakSilently, askQuestion]);

  const contextValue: TeacherContext = {
    state,
    document,
    metadata,
    currentPage,
    playbackPosition,
    conversationHistory,
    interruptionContext,
    audioMutex: audioMutexState,
    onboardingStep,
    loadDocument,
    startReading,
    pauseReading,
    resumeReading,
    activateListening,
    askQuestion,
    cancelListening,
    clearError,
    handleTouchDown,
    handleTouchUp,
    startOnboarding,
  };

  return (
    <TeacherContext.Provider value={contextValue}>
      {children}
    </TeacherContext.Provider>
  );
};

export const useTeacherContext = (): TeacherContext => {
  const context = useContext(TeacherContext);
  if (!context) {
    throw new Error('useTeacherContext must be used within a TeacherProvider');
  }
  return context;
};
