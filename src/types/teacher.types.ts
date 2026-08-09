/**
 * teacher.types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * TypeScript type definitions for the AI Interactive Teacher Mode.
 * 
 * Defines the Finite State Machine states, context structures, and interfaces
 * for the conversational PDF tutoring system.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Finite State Machine states for the AI Teacher Mode
 */
export type TeacherState =
  | 'IDLE'              // No document loaded, ready for input
  | 'PARSING_DOC'       // PDF being processed
  | 'AI_SPEAKING'       // TTS reading document content
  | 'LISTENING'         // Microphone active, awaiting user input
  | 'THINKING'          // Processing user question with LLM
  | 'ONBOARDING'        // Conversational setup flow
  | 'PAUSED'            // Playback paused, awaiting resume or question
  | 'ERROR';            // Error state with recovery path

/**
 * Page range specification for voice commands
 */
export interface PageRange {
  startPage: number;
  endPage: number;
  type: 'pages' | 'chapter';
  chapterName?: string;
}

/**
 * Conversation message structure
 */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  pageContext?: number; // Page number this message relates to
}

/**
 * Interruption context - saves state when user interrupts reading
 */
export interface InterruptionContext {
  savedPosition: {
    pageNumber: number;
    paragraphIndex: number;
    wordIndex: number;
    timestamp: number;
  };
  conversationContext: {
    lastSpokenText: string;
    pageContext: string;
    questionHistory: string[];
  };
}

/**
 * AI conversation payload sent to LLM
 */
export interface AIConversationPayload {
  documentId: string;
  currentPage: number;
  pageTextContext: string;
  userQuestion: string;
  playbackPositionMs: number;
  conversationHistory: ConversationMessage[];
}

/**
 * Audio mutex state for concurrency control
 */
export interface AudioMutexState {
  isPlaybackActive: boolean;
  isRecordingActive: boolean;
  isTTSActive: boolean;
  isLocked: boolean;
}

/**
 * Audio feedback types
 */
export type AudioFeedbackType = 'micOpen' | 'processing' | 'resuming' | 'cancel' | 'error';

/**
 * Audio feedback configuration
 */
export interface AudioFeedbackConfig {
  micOpen: {
    start: number;
    end: number;
    duration: number;
  };
  processing: {
    frequency: number;
    interval: number;
    repeat: boolean;
  };
  resuming: {
    start: number;
    end: number;
    duration: number;
  };
  cancel: {
    frequency: number;
    duration: number;
  };
  error: {
    frequencies: number[];
    duration: number;
  };
}

/**
 * User preferences for AI Teacher Mode
 */
export interface UserPreferences {
  speechRate: number;
  voicePreference: string;
  autoResume: boolean;
  hapticFeedback: boolean;
}

/**
 * Persistent state structure
 */
export interface PersistentState {
  activeDocument: {
    id: string;
    uri: string;
    lastPageNumber: number;
    lastPosition: number;
  } | null;
  conversationHistory: {
    documentId: string;
    messages: ConversationMessage[];
    timestamp: number;
  }[];
  userPreferences: UserPreferences;
}

import { EducationalMetadata } from '../services/DataHubService';

/**
 * Teacher context interface
 */
export interface TeacherContext {
  // State
  state: TeacherState;
  document: ParsedDocument | null;
  metadata: EducationalMetadata | null;
  currentPage: number;
  pendingTeachPage: number | null;
  playbackPosition: number;
  conversationHistory: ConversationMessage[];
  interruptionContext: InterruptionContext | null;
  audioMutex: AudioMutexState;
  onboardingStep: number;

  // Actions
  loadDocument: (uri: string) => Promise<void>;
  startReading: (range: PageRange) => Promise<void>;
  pauseReading: () => Promise<void>;
  resumeReading: () => Promise<void>;
  activateListening: () => Promise<void>;
  askQuestion: (question: string) => Promise<void>;
  cancelListening: () => Promise<void>;
  clearError: () => void;
  handleTouchDown: () => Promise<boolean>;
  handleTouchUp: (recognizedText: string) => Promise<void>;
  submitTextCommand: (text: string) => Promise<void>;
  startOnboarding: () => Promise<void>;
}

/**
 * Parsed document structure (imported from pdf.types)
 */
export interface ParsedDocument {
  id: string;
  title: string;
  uri: string;
  totalPages: number;
  pages: ParsedPage[];
  metadata: DocumentMetadata;
}

export interface ParsedPage {
  pageNumber: number;
  text: string;
  paragraphs: string[];
  headings: Heading[];
  tables: Table[];
  textPosition: TextPosition[];
}

export interface Heading {
  level: number;
  text: string;
  position: number;
}

export interface Table {
  title: string;
  columns: string[];
  rows: string[][];
  position: number;
}

export interface TextPosition {
  start: number;
  end: number;
  text: string;
}

export interface DocumentMetadata {
  author?: string;
  subject?: string;
  keywords?: string[];
  creationDate?: string;
  modificationDate?: string;
}
