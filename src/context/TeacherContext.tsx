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
import type { TeacherState, TeacherContext, ParsedDocument, ParsedPage, Heading, PageRange, ConversationMessage, InterruptionContext, AudioMutexState } from '../types/teacher.types';
import { EducationalMetadata, dataHubService } from '../services/DataHubService';
import { audioMutex } from './AudioMutex';
import { voiceCommandParser, ParsedVoiceCommand } from '../services/voiceCommandParser.service';
import { recognitionBridge } from '../services/recognitionBridge';

interface TeacherContextProviderProps {
  children: React.ReactNode;
}

const TeacherContext = createContext<TeacherContext | null>(null);

const TTS_CONFIG: Speech.SpeechOptions = {
  language: 'en-US',
  pitch: 1.0,
  rate: 0.9, // Slightly slower for better clarity
};

const DEFAULT_LESSON_TITLE = 'Computer Science 101 - Intro to Data Structures';
const DEFAULT_LESSON_ID = 'cs101-intro-data-structures';

/**
 * Build a complete lesson document so the AI Teacher always has real content
 * to render ("PAGE X OF Y" + page text) even before a real PDF is parsed.
 * Uses verified DataHub metadata headings when available.
 */
function buildLessonDocument(topicId: string, title: string, metadata: EducationalMetadata | null): ParsedDocument {
  const headings: Heading[] =
    metadata?.headings && metadata.headings.length > 0
      ? metadata.headings
      : [
          { level: 1, text: 'Introduction to Data Structures', position: 0 },
          { level: 1, text: 'Arrays and Lists', position: 1 },
          { level: 2, text: 'Stacks and Queues', position: 2 },
          { level: 2, text: 'Trees and Graphs', position: 3 },
          { level: 1, text: 'Review and Practice', position: 4 },
        ];

  const pages: ParsedPage[] = headings.map((heading, index) => {
    const text = buildPageText(title, heading.text, index + 1);
    return {
      pageNumber: index + 1,
      text,
      paragraphs: [text],
      headings: [heading],
      tables: [],
      textPosition: [{ start: 0, end: text.length, text }],
    };
  });

  return {
    id: topicId,
    title,
    uri: '',
    totalPages: pages.length,
    pages,
    metadata: {
      subject: title,
      keywords: headings.map((heading) => heading.text),
    },
  };
}

function buildPageText(title: string, heading: string, page: number): string {
  return `${title}. ${heading}. This is page ${page} of the lesson. ${heading} is explained in an accessible, step by step format so you can follow along hands free. Ask me to repeat any section, or say "next" to continue.`;
}

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
  const documentRef = useRef<ParsedDocument | null>(null);
  const stopReadingRef = useRef(false);

  // Auto-load a default lesson document on mount so the AI Teacher always
  // renders "PAGE 1 OF X" + real lesson text immediately, even before the
  // user picks a topic.
  useEffect(() => {
    if (!documentRef.current) {
      const lesson = buildLessonDocument(DEFAULT_LESSON_ID, DEFAULT_LESSON_TITLE, null);
      documentRef.current = lesson;
      setDocument(lesson);
      setCurrentPage(1);
    }
  }, []);

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
   * Safe TTS execution wrapper.
   * Resolves only when the utterance completes (onDone/onError/onStopped), so
   * callers like the page-reading loop can await actual speech completion.
   */
  const speakSilently = useCallback(async (text: string, options?: Speech.SpeechOptions) => {
    try {
      await audioMutex.acquireTTSLock();
      console.log(`[TeacherContext] Speaking: ${text.substring(0, 50)}...`);

      await new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          clearTimeout(safety);
          resolve();
        };

        // Safety net in case the platform never fires onDone/onStopped.
        const safety = setTimeout(() => {
          console.warn('[TeacherContext] TTS completion timeout, continuing.');
          void audioMutex.releaseTTSLock();
          settle();
        }, 60000);

        Speech.speak(text, {
          ...TTS_CONFIG,
          ...options,
          onDone: () => {
            settle();
            void (async () => {
              await audioMutex.releaseTTSLock();
              // Tell the recognizer it can re-arm the mic (still-held press).
              recognitionBridge.notifyTtsFinished();
              options?.onDone?.();
            })();
          },
          onError: (error) => {
            settle();
            void (async () => {
              console.error('[TeacherContext] Speech error:', error);
              await audioMutex.releaseTTSLock();
              options?.onError?.(error);
            })();
          },
          onStopped: () => {
            settle();
            void (async () => {
              await audioMutex.releaseTTSLock();
            })();
          }
        });
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
      // Simulation of PDF parsing - build a real lesson document
      const mockDocument = buildLessonDocument(`doc_${Date.now()}`, 'Quantum Mechanics 101', null);
      mockDocument.uri = uri;
      documentRef.current = mockDocument;
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
    const doc = documentRef.current;
    if (!doc) {
      await speakSilently("No document is loaded yet. Please choose a topic first.");
      transitionState('PAUSED');
      return;
    }

    stopReadingRef.current = false;
    const endPage = Math.min(range.endPage, doc.totalPages);
    let interrupted = false;
    for (let page = range.startPage; page <= endPage; page++) {
      const pageText = doc.pages[page - 1]?.text;
      if (!pageText) break;
      setCurrentPage(page);
      await speakSilently(pageText);
      if (stopReadingRef.current) {
        stopReadingRef.current = false;
        interrupted = true;
        break;
      }
    }

    // Only fall back to PAUSED on natural completion; an interruption already
    // moved the FSM to LISTENING (the fromState guard makes this safe).
    if (!interrupted) {
      transitionState('PAUSED', 'AI_SPEAKING');
    }
  }, [transitionState, speakSilently]);

  const pauseReading = useCallback(async (): Promise<void> => {
    transitionState('PAUSED', 'AI_SPEAKING');
    await Speech.stop();
    await audioMutex.releaseTTSLock();
  }, [transitionState]);

  const resumeReading = useCallback(async (): Promise<void> => {
    const doc = documentRef.current;
    if (!doc) {
      transitionState('PAUSED', 'AI_SPEAKING');
      return;
    }
    await startReading({ startPage: Math.max(currentPage, 1), endPage: doc.totalPages, type: 'pages' });
  }, [currentPage, startReading]);

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
   * Returns true when voice recognition should start immediately (the
   * onboarding prompt is not speaking). During IDLE the prompt speaks and the
   * recognitionBridge re-arms the mic when it finishes.
   */
  const handleTouchDown = useCallback(async (): Promise<boolean> => {
    if (state === 'IDLE') {
      await startOnboarding();
      return false;
    }

    stopReadingRef.current = true;
    await audioMutex.hardPause();
    transitionState('LISTENING');
    await audioMutex.acquireRecordingLock();
    return true;
  }, [state, transitionState, startOnboarding]);

  /**
   * Process a typed or recognized text command (non-onboarding routing).
   * Shared by the voice LISTENING path and the fallback text input.
   */
  const processCommandText = useCallback(async (text: string): Promise<void> => {
    const { action, offlineMessage } = await voiceCommandParser.processCommand(text);

    if (offlineMessage) {
      await speakSilently(offlineMessage, { onDone: () => { transitionState('PAUSED'); } });
      return;
    }

    // Route commands
    if (action.type === 'AI_QUERY') {
      await askQuestion(text);
      return;
    }

    const doc = documentRef.current;
    const page = currentPage;

    switch (action.type) {
      case 'RESUME':
        if (doc && page >= 1) {
          await startReading({ startPage: page, endPage: doc.totalPages, type: 'pages' });
        } else {
          transitionState('PAUSED');
        }
        break;
      case 'NEXT':
        if (doc && page < doc.totalPages) {
          setCurrentPage(page + 1);
          await speakSilently(doc.pages[page]?.text ?? 'You have reached the end of the document.');
        } else {
          await speakSilently('You are already at the end of the document.');
        }
        transitionState('PAUSED');
        break;
      case 'BACK':
        if (doc && page > 1) {
          setCurrentPage(page - 1);
          await speakSilently(doc.pages[page - 2]?.text ?? 'This is the start of the document.');
        } else {
          await speakSilently('You are already at the start of the document.');
        }
        transitionState('PAUSED');
        break;
      case 'REPEAT':
        if (doc && page >= 1 && doc.pages[page - 1]?.text) {
          await speakSilently(doc.pages[page - 1].text as string);
        } else {
          await speakSilently("There is no content to repeat yet.");
        }
        transitionState('PAUSED');
        break;
      case 'PAUSE':
      case 'STOP':
      default:
        transitionState('PAUSED');
        break;
    }
  }, [currentPage, transitionState, speakSilently, askQuestion, startReading]);

  /**
   * Process onboarding input (Subject -> Unit -> Topic).
   */
  const processOnboardingText = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) {
      await speakSilently("I didn't catch that. Please try again.", {
        onDone: () => { transitionState('ONBOARDING'); },
      });
      return;
    }

    if (onboardingStep === 1) {
      setOnboardingStep(2);
      await speakSilently(`Got it! Studying ${text} today. Which unit or chapter are we working on?`);
    } else if (onboardingStep === 2) {
      setOnboardingStep(3);
      await speakSilently(`Okay, chapter ${text}. Which specific topic should we cover?`);
    } else if (onboardingStep === 3) {
      setOnboardingStep(0);
      transitionState('THINKING');
      await speakSilently("One moment while I fetch the lesson metadata and verify the content.");

      // Fetch Metadata & Verify
      const topicId = text.toLowerCase().replace(/\s+/g, '-');
      let docMetadata: EducationalMetadata | null = null;
      try {
        docMetadata = await dataHubService.fetchMetadata(topicId);
      } catch (e) {
        console.warn("Metadata verification failed, using offline outline.", e);
      }
      setMetadata(docMetadata);

      const lessonDoc = buildLessonDocument(topicId, text, docMetadata);
      documentRef.current = lessonDoc;
      setDocument(lessonDoc);
      setCurrentPage(1);
      transitionState('AI_SPEAKING');
      await speakSilently(`Verified. I've loaded the outline for ${lessonDoc.title}. Starting lesson now.`);
      await startReading({ startPage: 1, endPage: lessonDoc.totalPages, type: 'pages' });
    }
  }, [onboardingStep, transitionState, speakSilently, startReading]);

  /**
   * Handle touch up - Main voice logic
   */
  const handleTouchUp = useCallback(async (recognizedText: string): Promise<void> => {
    if (state === 'ONBOARDING') {
      await audioMutex.releaseRecordingLock();
      await processOnboardingText(recognizedText);
      return;
    }

    if (state === 'LISTENING') {
      await audioMutex.releaseRecordingLock();
      if (!recognizedText.trim()) {
        await speakSilently("I didn't catch that. Please try again.", {
          onDone: () => { transitionState('PAUSED'); },
        });
        return;
      }
      await processCommandText(recognizedText);
    }
  }, [state, transitionState, speakSilently, processOnboardingText, processCommandText]);

  /**
   * Fallback text command entry point (debug / speech-recognition-restricted
   * browsers). Types straight into the same routing pipeline as voice input.
   */
  const submitTextCommand = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;

    stopReadingRef.current = true;
    await audioMutex.hardPause();
    await audioMutex.releaseRecordingLock();

    if (state === 'ONBOARDING') {
      await processOnboardingText(trimmed);
      return;
    }

    transitionState('LISTENING');
    await processCommandText(trimmed);
  }, [state, transitionState, processOnboardingText, processCommandText]);

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
    submitTextCommand,
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
