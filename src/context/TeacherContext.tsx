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
import { modeBridge } from '../services/modeBridge';

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
 * Conversational lesson content bank. The AI Teacher explains key concepts
 * and pairs each with a practical, real-world analogy instead of reading raw
 * text line-by-line — the requirement for blind accessibility.
 */
interface LessonEntry {
  keywords: string[];
  content: string;
  analogy: string;
}

const LESSON_BANK: LessonEntry[] = [
  {
    keywords: ['introduction', 'data structures', 'intro'],
    content:
      'Data structures are ways of organizing data so a program can use it quickly and correctly. They are the building blocks of almost every program, because they decide how fast information can be stored, searched, and retrieved.',
    analogy:
      'Think of data structures like a well organized closet: the better your shelves and labels, the faster you find what you need.',
  },
  {
    keywords: ['array', 'list', 'lists'],
    content:
      'An array stores items in a fixed, numbered sequence, like seats in a row. A list can grow and shrink as you add or remove items, like a guest list that keeps changing.',
    analogy:
      'An array is like a row of lockers, each with a number, so you can jump straight to locker five. A list is more like a paper guest list that you cross off and rewrite.',
  },
  {
    keywords: ['stack', 'queue'],
    content:
      'A stack adds and removes items only from the top, like a stack of plates. A queue adds at the back and removes from the front, like a line at a ticket counter.',
    analogy:
      'A stack is plates in a cafeteria: the last plate placed is the first one used. A queue is a line at the store: first come, first served.',
  },
  {
    keywords: ['tree', 'graph'],
    content:
      'A tree organizes data into levels with a single starting point, the root, branching into children. A graph connects items freely, so any item can link to any other, like a city map.',
    analogy:
      'A tree is like a family tree, parents branching to children. A graph is like a subway map, stations connected by many different lines.',
  },
  {
    keywords: ['review', 'practice'],
    content:
      'In review, we pull everything together: choosing the right structure for the job, and practicing with small examples until each pattern feels natural.',
    analogy:
      'Review is like a musician running scales: repeating the basics slowly makes the hard pieces feel easy.',
  },
];

function findLessonEntry(heading: string): LessonEntry {
  const normalized = heading.toLowerCase();
  const entry = LESSON_BANK.find((candidate) =>
    candidate.keywords.some((keyword) => normalized.includes(keyword))
  );
  return (
    entry ?? {
      keywords: [],
      content: `${heading} is explored step by step so you can follow along hands free, building understanding from the ground up.`,
      analogy:
        'Every new idea builds on what you already know, the same way climbing stairs lifts you higher one step at a time.',
    }
  );
}

/**
 * Build the conversational teacher explanation for a page: states the topic,
 * explains the key idea, offers a real-world analogy, and checks in with the
 * student so they stay in control of the pace.
 */
function buildTeacherExplanation(doc: ParsedDocument, pageNumber: number): string {
  const page = doc.pages[pageNumber - 1];
  if (!page) return 'Sorry, that page is not available.';
  const heading = page.headings?.[0]?.text ?? `Page ${pageNumber}`;
  const entry = findLessonEntry(heading);
  return (
    `Let's talk about ${heading}. ` +
    `${entry.content} ` +
    `Think of it this way: ${entry.analogy} ` +
    `Do you follow so far? Say 'next' to move on, 'repeat' to hear this again, or tell me a topic or question.`
  );
}

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
  const entry = findLessonEntry(heading);
  return `${title}. ${heading}. ${entry.content} Ask me to repeat any part, or say "next" to continue.`;
}

/**
 * Detect a friendly greeting ("hello", "hi", "hey", "good morning") in spoken
 * or typed command text. Word-boundary matching avoids matching inside other
 * words like "this" or "history".
 */
function detectGreeting(text: string): boolean {
  const cleanText = text.toLowerCase().trim();
  return /(?:^|\W)(?:hello|hi|hey|good morning|good afternoon|good evening)(?:$|\W)/.test(cleanText);
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
  const [pendingTeachPage, setPendingTeachPage] = useState<number | null>(null);

  // Refs for async operations
  const stateTransitionRef = useRef<TeacherState>('IDLE');
  const isTransitioningRef = useRef(false);
  const documentRef = useRef<ParsedDocument | null>(null);
  const stopReadingRef = useRef(false);
  const pendingTeachPageRef = useRef<number | null>(null);

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

  // Warm first impression: greet once per session and immediately enter
  // listening mode. We do NOT auto-read the lesson — the student stays in
  // control and explicitly asks before teaching begins. Re-entries (mode
  // switches) confirm the switch and open the mic for commands.
  useEffect(() => {
    if (!autoGreetingPlayed) {
      autoGreetingPlayed = true;
      void startGreeting();
    } else {
      const doc = documentRef.current;
      if (doc) {
        transitionState('AI_SPEAKING');
        void speakSilently(
          'Switched to the AI Teacher. We are on page 1. What would you like to do? Say start to begin, or tell me a topic.'
        ).then(() => rearmAutoListen());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
   * Re-arm the speak-then-listen loop: move the FSM to LISTENING (unless we
   * are mid-onboarding, which keeps its own state) and ask the recognizer to
   * open the mic hands-free via the bridge.
   */
  const rearmAutoListen = useCallback(async () => {
    if (stateTransitionRef.current === 'LISTENING') return;
    // Strictly wait for any in-flight TTS to finish (or be cancelled) before
    // opening the mic, so the AI's own voice can never be captured back as a
    // phantom command. Bounded so a stuck TTS engine cannot hang the loop.
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && (await Speech.isSpeakingAsync())) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (stateTransitionRef.current !== 'ONBOARDING') {
      transitionState('LISTENING');
    }
    await audioMutex.acquireRecordingLock();
    recognitionBridge.notifyAutoListen();
  }, [transitionState]);

  /**
   * Warm spoken response to a friendly greeting ("hello", "hi", "hey").
   * Re-arms the mic afterwards so the student can immediately say what they
   * want to do next.
   */
  const respondToGreeting = useCallback(async () => {
    transitionState('AI_SPEAKING');
    await speakSilently(
      "Hello! I'm your AI Teacher. What would you like to do today? " +
      "You can ask me to start reading page 1, summarize the chapter, or switch modes."
    );
    transitionState('PAUSED');
    await rearmAutoListen();
  }, [speakSilently, transitionState, rearmAutoListen]);

  /**
   * Speak a spoken chapter outline / summary of the loaded lesson, then
   * re-arm the hands-free microphone so the student can pick a starting
   * point.
   */
  const summarizeChapter = useCallback(async () => {
    const doc = documentRef.current;
    if (!doc || doc.totalPages < 1) {
      await speakSilently("No lesson is loaded yet. Say start teaching to begin.");
      transitionState('PAUSED');
      await rearmAutoListen();
      return;
    }

    const sectionNames = doc.pages
      .map((page) => page.headings?.[0]?.text ?? `Page ${page.pageNumber}`)
      .filter(Boolean);
    const outline = sectionNames.join('. ');
    const summary =
      `Here is a summary of ${doc.title}. The lesson has ${doc.totalPages} pages and covers ${outline}. ` +
      `Would you like me to start reading from page one?`;

    await speakSilently(summary);
    transitionState('PAUSED');
    await rearmAutoListen();
  }, [speakSilently, transitionState, rearmAutoListen]);

  /**
   * Warm first impression: welcome the student, teach the navigation words,
   * then hand over control. No lesson content is read automatically.
   */
  const startGreeting = useCallback(async () => {
    const doc = documentRef.current;
    if (!doc || doc.totalPages < 1) return;

    setCurrentPage(1);
    transitionState('AI_SPEAKING');
    const greeting =
      `Welcome to EduAudio! What subject would you like to learn today? ` +
      `To navigate, you can say 'next' to go forward, 'previous' to go back, ` +
      `'repeat' to hear this again, or tell me to switch modes.`;
    await speakSilently(greeting);
    await rearmAutoListen();
  }, [speakSilently, transitionState, rearmAutoListen]);

  /**
   * Announce a page and ask for explicit confirmation before teaching it.
   * Sets the pending-teach marker so the next confirmation ("yes", "go
   * ahead", "explain") triggers the actual lesson speech.
   */
  const announcePage = useCallback(async (pageNumber: number): Promise<void> => {
    const doc = documentRef.current;
    if (!doc) {
      await speakSilently('No document is loaded yet. Please tell me a topic first.');
      transitionState('PAUSED');
      await rearmAutoListen();
      return;
    }

    const clamped = Math.max(1, Math.min(pageNumber, doc.totalPages));
    setCurrentPage(clamped);
    pendingTeachPageRef.current = clamped;
    setPendingTeachPage(clamped);
    transitionState('AI_SPEAKING');
    await speakSilently(`Moved to Page ${clamped}. Say 'go ahead' to begin the detailed explanation.`);
    await rearmAutoListen();
  }, [transitionState, speakSilently, rearmAutoListen]);

  /**
   * Deep conversational teaching of a single page: concept explanation plus a
   * real-world analogy, then a check-in with the student. Clears the pending
   * confirmation because the lesson has been explicitly approved.
   */
  const teachPage = useCallback(async (pageNumber: number): Promise<void> => {
    const doc = documentRef.current;
    if (!doc) {
      await speakSilently('No document is loaded yet. Please tell me a topic first.');
      transitionState('PAUSED');
      await rearmAutoListen();
      return;
    }

    const clamped = Math.max(1, Math.min(pageNumber, doc.totalPages));
    setCurrentPage(clamped);
    pendingTeachPageRef.current = null;
    setPendingTeachPage(null);
    transitionState('AI_SPEAKING');
    await speakSilently(buildTeacherExplanation(doc, clamped));
    await rearmAutoListen();
  }, [transitionState, speakSilently, rearmAutoListen]);

  /**
   * Topic selection: the student named a subject with no heading match, so we
   * build a lesson document for it and confirm before teaching.
   */
  const selectTopic = useCallback(async (topic: string): Promise<void> => {
    const topicId = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'topic';

    let docMetadata: EducationalMetadata | null = null;
    try {
      docMetadata = await dataHubService.fetchMetadata(topicId);
    } catch (e) {
      console.warn('[TeacherContext] Metadata verification failed, using offline outline.', e);
    }
    setMetadata(docMetadata);

    const lessonDoc = buildLessonDocument(topicId, topic, docMetadata);
    documentRef.current = lessonDoc;
    setDocument(lessonDoc);
    setCurrentPage(1);
    pendingTeachPageRef.current = 1;
    setPendingTeachPage(1);
    transitionState('AI_SPEAKING');
    const heading = lessonDoc.pages[0]?.headings?.[0]?.text ?? lessonDoc.title;
    await speakSilently(`Great! We are on Page 1: ${heading}. Should I begin explaining?`);
    await rearmAutoListen();
  }, [transitionState, speakSilently, rearmAutoListen]);

  /**
   * Start Onboarding Flow — single-step: ask the student for a subject, then
   * route the answer through topic selection + confirmation.
   */
  const startOnboarding = useCallback(async () => {
    transitionState('ONBOARDING');
    setOnboardingStep(1);
    await speakSilently("Welcome to Edu Audio! What subject would you like to study today?");
    await rearmAutoListen();
  }, [transitionState, speakSilently, rearmAutoListen]);

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
      // Speak-then-listen: after the page finishes, open the mic hands-free.
      await rearmAutoListen();
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
    // Re-confirm the current page before teaching, keeping the student in
    // control of when the lesson speech actually starts.
    await announcePage(Math.max(currentPage, 1));
  }, [currentPage, announcePage]);

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
   * Instant voice interruption ("stop", "pause", "wait", "be quiet"): cancel
   * all active speech right away, move the FSM to PAUSED, then after a short
   * delay quietly acknowledge the pause and re-arm the hands-free mic so the
   * student can say 'go ahead' or 'continue' when ready.
   */
  const pauseAndConfirm = useCallback(async (): Promise<void> => {
    stopReadingRef.current = true;
    await Speech.stop();
    await audioMutex.releaseTTSLock();
    transitionState('PAUSED');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await speakSilently("Paused. Say 'go ahead' or 'continue' when you're ready.");
    await rearmAutoListen();
  }, [transitionState, speakSilently, rearmAutoListen]);

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
   * Route a spoken topic or question. Topic names that match a document
   * heading (or the lesson content bank) select that page and ask for
   * confirmation; clear questions go to the LLM/fallback; anything else is
   * treated as a new topic the student wants to study.
   */
  const handleTopicOrQuestion = useCallback(async (text: string): Promise<void> => {
    const doc = documentRef.current;
    const lower = text.trim().toLowerCase();

    if (doc) {
      const matchIndex = doc.pages.findIndex((page) => {
        const heading = page.headings?.[0]?.text ?? '';
        const entry = heading ? findLessonEntry(heading) : null;
        return (
          (heading && lower.includes(heading.toLowerCase())) ||
          (entry?.keywords.some((keyword) => lower.includes(keyword)) ?? false)
        );
      });

      if (matchIndex >= 0) {
        const target = matchIndex + 1;
        const heading = doc.pages[matchIndex]?.headings?.[0]?.text ?? `Page ${target}`;
        setCurrentPage(target);
        pendingTeachPageRef.current = target;
        setPendingTeachPage(target);
        transitionState('AI_SPEAKING');
        await speakSilently(`Great! We are on Page ${target}: ${heading}. Should I begin explaining?`);
        await rearmAutoListen();
        return;
      }
    }

    const isQuestion =
      /\?\s*$/.test(lower) ||
      /^(what|why|how|when|where|who|which)\b/.test(lower) ||
      /^(tell me|explain (why|how|what)|define|describe)\b/.test(lower);

    if (isQuestion) {
      await askQuestion(text);
      return;
    }

    await selectTopic(text);
  }, [transitionState, speakSilently, rearmAutoListen, askQuestion, selectTopic]);

  /**
   * Voice-driven mode switching. Switching to the Audio Player hands the
   * request to the top-level mode bridge: App swaps the screens and speaks
   * the confirmation. Switching to the AI Teacher while already here just
   * confirms the current mode (App's own bridge early-returns on a same-mode
   * request, so the confirmation lives here).
   */
  const switchMode = useCallback(async (target: 'player' | 'teacher'): Promise<void> => {
    if (target === 'player') {
      modeBridge.requestMode('player');
      return;
    }
    await speakSilently('You are already in the AI Teacher. What would you like to do?');
    transitionState('PAUSED');
    await rearmAutoListen();
  }, [speakSilently, transitionState, rearmAutoListen]);

  /**
   * Process a typed or recognized text command (non-onboarding routing).
   * Shared by the voice LISTENING path and the fallback text input.
   */
  const processCommandText = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();

    // Friendly greetings ("hello", "hi") get a warm spoken response instead of
    // being treated as an AI question.
    if (detectGreeting(trimmed)) {
      await respondToGreeting();
      return;
    }

    const { action } = await voiceCommandParser.processCommand(trimmed);

    // Route commands
    if (action.type === 'AI_QUERY') {
      await handleTopicOrQuestion(text);
      return;
    }

    const doc = documentRef.current;
    const page = currentPage;

    switch (action.type) {
      case 'START_TEACHING': {
        const explicitPage = action.parameters?.pageNumber;
        if (pendingTeachPageRef.current != null) {
          // Student confirmed the announced page -> teach it now.
          await teachPage(pendingTeachPageRef.current);
        } else if (explicitPage != null) {
          await announcePage(explicitPage);
        } else {
          // "go ahead" / "teach me" / "start" with no pending announcement:
          // the student is asking to begin, so teach the current page.
          await teachPage(page >= 1 ? page : 1);
        }
        break;
      }
      case 'NEXT':
        if (doc && page < doc.totalPages) {
          const amount = action.parameters?.amount ?? 1;
          // Advance AND teach: "next" moves to the next page and reads it
          // right away, so the student never needs a separate confirmation.
          await teachPage(page + amount);
        } else {
          await speakSilently('You are already at the end of the document.');
          transitionState('PAUSED');
          await rearmAutoListen();
        }
        break;
      case 'BACK':
        if (doc && page > 1) {
          const amount = action.parameters?.amount ?? 1;
          await teachPage(page - amount);
        } else {
          await speakSilently('You are already at the start of the document.');
          transitionState('PAUSED');
          await rearmAutoListen();
        }
        break;
      case 'REPEAT':
        if (doc && page >= 1 && doc.pages[page - 1]) {
          await teachPage(page);
        } else {
          await speakSilently('There is no content to repeat yet.');
          transitionState('PAUSED');
          await rearmAutoListen();
        }
        break;
      case 'SUMMARIZE':
        await summarizeChapter();
        break;
      case 'RESUME':
        if (doc && page >= 1) {
          await announcePage(page);
        } else {
          transitionState('PAUSED');
          await rearmAutoListen();
        }
        break;
      case 'SWITCH_PLAYER':
        await switchMode('player');
        break;
      case 'SWITCH_TEACHER':
        await switchMode('teacher');
        break;
      case 'PAUSE':
      case 'STOP':
        transitionState('PAUSED');
        break;
      case 'UNKNOWN':
      default:
        await speakSilently("I didn't catch that. Say 'next' to move forward, 'back' to go back, 'repeat' to hear this again, or tell me a topic to begin.");
        transitionState('PAUSED');
        await rearmAutoListen();
        break;
    }
  }, [currentPage, transitionState, speakSilently, teachPage, summarizeChapter, respondToGreeting, handleTopicOrQuestion, switchMode, rearmAutoListen]);

  /**
   * Process onboarding input — single-step topic selection.
   */
  const processOnboardingText = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) {
      await speakSilently("I didn't catch that. Please try again.");
      await rearmAutoListen();
      return;
    }
    setOnboardingStep(0);
    transitionState('THINKING');
    await speakSilently('One moment while I prepare that subject.');
    await selectTopic(text.trim());
  }, [transitionState, speakSilently, selectTopic, rearmAutoListen]);

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
    pendingTeachPage,
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
    pauseAndConfirm,
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
