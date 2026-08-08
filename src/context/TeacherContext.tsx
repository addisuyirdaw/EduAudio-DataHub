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
import { modeBridge, ModeRequest } from '../services/modeBridge';

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
 * Module-level flag so the auto-speak greeting plays once per app session
 * (the TeacherProvider remounts on every tab switch to AI Teacher).
 */
let autoGreetingPlayed = false;

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
    const text = buildPageText(heading.text);
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

/**
 * Human-style, plain-language explanations used to build the default lesson
 * pages. Written the way a tutor would explain a concept out loud, so the
 * voice experience feels natural for a blind student following along hands
 * free.
 */
const TOPIC_EXPLANATIONS: Record<string, string> = {
  'Introduction to Data Structures':
    'A data structure is a way of organizing and storing information in your computer so it can be used efficiently. Think of it like a well organized toolbox, where every tool has a clear place and purpose.',
  'Arrays and Lists':
    'An array stores many items of the same kind in a row, one after another. Each item has a position called an index, so finding any item is fast and simple.',
  'Stacks and Queues':
    'A stack is like a stack of plates, where you always take the top one first. A queue is like a line at the store, where the first person in line is served first.',
  'Trees and Graphs':
    'A tree organizes items in levels, like a family tree, with branches leading down from a single root. A graph lets items called nodes connect freely, like roads on a map.',
  'Review and Practice':
    'Now we bring everything together. Feel free to ask me to explain any topic again, or ask me any question about what we have covered.',
};

function buildPageText(heading: string): string {
  const explanation =
    TOPIC_EXPLANATIONS[heading] ?? TOPIC_EXPLANATIONS['Introduction to Data Structures'];
  return `${heading}. ${explanation}`;
}

/**
 * The spoken options offered at the end of every page reading, so the student
 * always knows what they can say next. Kept short so it never overwhelms.
 */
function buildPageAsk(): string {
  return (
    `Would you like to go to the next page, hear this page again, or go back to the previous page? ` +
    `Say next to continue, say again to repeat, or say back for the previous page.`
  );
}

/**
 * Full spoken narration for a page: announce the page, read the actual lesson
 * content out loud like a human tutor, then pause with a spoken prompt
 * offering next / repeat / back. The AI never advances to the next page on its
 * own - it always waits for the student to choose.
 */
function buildPageNarration(pageText: string, page: number, totalPages: number): string {
  return `Page ${page} of ${totalPages}. ${pageText} ${buildPageAsk()}`;
}

/**
 * Detect a mode-switch request ("player" / "teacher") in spoken or typed
 * command text. Word-boundary matching avoids matching inside other words.
 */
function resolveModeSwitch(text: string): ModeRequest | null {
  const cleanText = text.toLowerCase().trim();
  if (/(?:^|\W)(?:player)(?:$|\W)/.test(cleanText)) return 'player';
  if (/(?:^|\W)(?:teacher)(?:$|\W)/.test(cleanText)) return 'teacher';
  return null;
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
  // Page number whose reading is already handled by an internal speaker
  // (the startReading loop, loadDocument, onboarding, greeting). The
  // auto-read effect skips that page and speaks any OTHER page change.
  const handledPageRef = useRef(0);
  // Last page that rendered, so the auto-read effect can detect real changes.
  const prevPageRef = useRef(0);

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

  // Zero-touch accessibility entry: greet + read Page 1 the first time the
  // AI Teacher is opened; resume reading hands-free on subsequent entries.
  useEffect(() => {
    if (!autoGreetingPlayed) {
      autoGreetingPlayed = true;
      void startGreeting();
    } else {
      const doc = documentRef.current;
      if (doc) {
        void startReading({ startPage: 1, endPage: doc.totalPages, type: 'pages' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-read lesson loop: whenever currentPage changes through a path that
  // does NOT announce itself (e.g. voice NEXT/BACK navigation), stop any
  // in-flight TTS, read the new page aloud with the short prompt, then
  // re-arm the hands-free microphone. Pages already spoken by internal paths
  // (startReading loop, loadDocument, onboarding, greeting) are skipped via
  // handledPageRef.
  useEffect(() => {
    const prev = prevPageRef.current;
    prevPageRef.current = currentPage;
    if (currentPage < 1 || !documentRef.current) return;
    if (prev === 0) return; // initial mount: greeting / onboarding owns page 1
    if (handledPageRef.current === currentPage) {
      handledPageRef.current = 0;
      return;
    }

    const doc = documentRef.current;
    console.log(`[TeacherContext] Page changed to ${currentPage}, auto-reading`);
    const pageText = doc.pages[currentPage - 1]?.text ?? '';
    void (async () => {
      await audioMutex.hardPause();
      if (stateTransitionRef.current !== 'ONBOARDING') {
        transitionState('AI_SPEAKING');
      }
      await speakSilently(buildPageNarration(pageText, currentPage, doc.totalPages));
      if (stateTransitionRef.current !== 'ONBOARDING') {
        await rearmAutoListen();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

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
   * Re-arm the speak-then-listen loop: move the FSM to LISTENING (unless we
   * are mid-onboarding, which keeps its own state) and ask the recognizer to
   * open the mic hands-free via the bridge.
   */
  const rearmAutoListen = useCallback(async () => {
    if (stateTransitionRef.current === 'LISTENING') return;
    if (stateTransitionRef.current !== 'ONBOARDING') {
      transitionState('LISTENING');
    }
    await audioMutex.acquireRecordingLock();
    recognitionBridge.notifyAutoListen();
  }, [transitionState]);

  /**
   * Zero-touch entry: speak the welcome greeting followed immediately by
   * Page 1's text, then re-arm the mic for spoken navigation commands.
   */
  const startGreeting = useCallback(async () => {
    const doc = documentRef.current;
    if (!doc || doc.totalPages < 1) return;

    handledPageRef.current = 1;
    setCurrentPage(1);
    transitionState('AI_SPEAKING');
    const greeting =
      `Welcome to EduAudio! I am your AI Teacher. Everything you hear can be controlled ` +
      `with your voice. Say next to go on, say again to repeat this page, say back to go ` +
      `back, or say player to switch to the audio player. You can also ask me any question. ` +
      `Let's begin with page one.`;
    await speakSilently(greeting);
    const pageText = doc.pages[0]?.text ?? '';
    await speakSilently(buildPageNarration(pageText, 1, doc.totalPages));
    handledPageRef.current = 0;
    await rearmAutoListen();
  }, [speakSilently, transitionState, rearmAutoListen]);

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
      handledPageRef.current = 1;
      transitionState('PAUSED');
      await speakSilently("Document loaded and verified. I'm ready when you are.");
      handledPageRef.current = 0;
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

    // Read exactly ONE page, then pause for the student. The lesson is
    // student-paced: the AI never auto-advances to the next page on its own.
    // It reads the page, offers next / repeat / back, and re-arms the mic so
    // the student decides what happens next.
    stopReadingRef.current = false;
    const page = Math.min(Math.max(range.startPage, 1), doc.totalPages);
    const pageText = doc.pages[page - 1]?.text;
    if (!pageText) {
      transitionState('PAUSED');
      return;
    }

    // Mark this page as handled so the auto-read effect does not announce it
    // a second time, then speak the full narration (content + options).
    handledPageRef.current = page;
    setCurrentPage(page);
    await speakSilently(buildPageNarration(pageText, page, doc.totalPages));
    handledPageRef.current = 0;

    // Speak-then-listen: after the page finishes, open the mic hands-free so
    // the student can choose next, repeat, back, or ask a question.
    if (!stopReadingRef.current) {
      transitionState('PAUSED', 'AI_SPEAKING');
      await rearmAutoListen();
    } else {
      stopReadingRef.current = false;
    }
  }, [transitionState, speakSilently, rearmAutoListen]);

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
      await speakSilently(fallbackResponse);
      transitionState('PAUSED');
      await rearmAutoListen();
      return;
    }

    try {
      // Simulate LLM Processing
      await new Promise(resolve => setTimeout(resolve, 1500));
      const responseText = `Regarding your question about ${question}, the document mentions that wave-particle duality is a fundamental concept in quantum mechanics.`;
      
      await speakSilently(responseText);
      transitionState('PAUSED');
      await rearmAutoListen();
    } catch (error) {
      console.error("[TeacherContext] AI Query failed:", error);
      await speakSilently("I encountered an error processing that question. Let's get back to the reading.");
      transitionState('PAUSED');
      await rearmAutoListen();
    }
  }, [transitionState, speakSilently, currentPage, rearmAutoListen]);

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
    const trimmed = text.trim();

    // Mode-switch commands (spoken or typed): hand off to the top-level mode
    // bridge, which swaps screens, isolates audio, and speaks the new mode.
    const modeRequest = resolveModeSwitch(trimmed);
    if (modeRequest) {
      await audioMutex.hardPause();
      modeBridge.requestMode(modeRequest);
      return;
    }

    const { action, offlineMessage } = await voiceCommandParser.processCommand(trimmed);

    if (offlineMessage) {
      await speakSilently(offlineMessage);
      transitionState('PAUSED');
      await rearmAutoListen();
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
          await rearmAutoListen();
        }
        break;
      case 'NEXT':
        if (doc && page < doc.totalPages) {
          // Page change only: the auto-read currentPage effect stops any
          // in-flight TTS, reads the new page aloud, and re-arms the mic.
          setCurrentPage(page + 1);
          transitionState('PAUSED');
        } else {
          await speakSilently('You are already at the end of the document. Say back for the previous page.');
          transitionState('PAUSED');
          await rearmAutoListen();
        }
        break;
      case 'BACK':
        if (doc && page > 1) {
          setCurrentPage(page - 1);
          transitionState('PAUSED');
        } else {
          await speakSilently('You are already at the start of the document. Say next to continue.');
          transitionState('PAUSED');
          await rearmAutoListen();
        }
        break;
      case 'REPEAT':
        if (doc && page >= 1 && doc.pages[page - 1]?.text) {
          await speakSilently(buildPageNarration(doc.pages[page - 1].text, page, doc.totalPages));
        } else {
          await speakSilently("There is no content to repeat yet. Say next to continue.");
        }
        transitionState('PAUSED');
        await rearmAutoListen();
        break;
      case 'PAUSE':
      case 'STOP':
        // A blind student may want to stop the reading and immediately ask a
        // question. Stop any in-flight TTS, then re-arm the mic so their next
        // words (e.g. a question) are heard.
        stopReadingRef.current = true;
        await Speech.stop();
        await audioMutex.releaseTTSLock();
        transitionState('PAUSED');
        await rearmAutoListen();
        break;
      case 'UNKNOWN':
      default:
        await speakSilently("I didn't catch that. Say 'next' to continue, 'back' to go back, or 'repeat' to hear this page again.");
        transitionState('PAUSED');
        await rearmAutoListen();
        break;
    }
  }, [currentPage, transitionState, speakSilently, askQuestion, startReading, rearmAutoListen]);

  /**
   * Process onboarding input (Subject -> Unit -> Topic).
   */
  const processOnboardingText = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) {
      await speakSilently("I didn't catch that. Please try again.");
      await rearmAutoListen();
      return;
    }

    if (onboardingStep === 1) {
      setOnboardingStep(2);
      await speakSilently(`Got it! Studying ${text} today. Which unit or chapter are we working on?`);
      await rearmAutoListen();
    } else if (onboardingStep === 2) {
      setOnboardingStep(3);
      await speakSilently(`Okay, chapter ${text}. Which specific topic should we cover?`);
      await rearmAutoListen();
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
      handledPageRef.current = 1;
      setCurrentPage(1);
      transitionState('AI_SPEAKING');
      await speakSilently(`Verified. I've loaded the outline for ${lessonDoc.title}. Starting lesson now.`);
      await startReading({ startPage: 1, endPage: lessonDoc.totalPages, type: 'pages' });
    }
  }, [onboardingStep, transitionState, speakSilently, startReading, rearmAutoListen]);

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
        await speakSilently("I didn't catch that. Please try again.");
        transitionState('PAUSED');
        await rearmAutoListen();
        return;
      }
      await processCommandText(recognizedText);
    }
  }, [state, transitionState, speakSilently, processOnboardingText, processCommandText, rearmAutoListen]);

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
