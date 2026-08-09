/**
 * voiceCommandParser.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Voice Command Parser Service
 * 
 * Parses voice input using regex patterns to identify local control commands
 * (navigation, confirmation, mode switching, summarizing) vs. AI queries.
 * Topic selection and navigation are fully offline; AI queries degrade
 * gracefully in the teacher engine when no API key is configured.
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Voice command types
 */
export type VoiceCommandType =
  | 'PAUSE'            // Pause playback
  | 'STOP'             // Stop playback
  | 'RESUME'           // Resume / re-confirm current section
  | 'NEXT'             // Advance to the next page
  | 'BACK'             // Go back to the previous page
  | 'REPEAT'           // Repeat / re-explain current content
  | 'START_TEACHING'   // Topic / confirmation to begin teaching
  | 'SWITCH_PLAYER'    // Switch to the Audio Player mode
  | 'SWITCH_TEACHER'   // Switch to the AI Teacher mode
  | 'SUMMARIZE'        // Summarize the current lesson/chapter
  | 'AI_QUERY'         // Query requiring AI processing
  | 'UNKNOWN';         // Unrecognized command

/**
 * Parsed voice command result
 */
export interface ParsedVoiceCommand {
  type: VoiceCommandType;
  isLocal: boolean;           // Can be executed offline
  requiresNetwork: boolean;   // Requires network connection
  originalText: string;
  parameters?: {
    amount?: number;         // For "next 2" -> skip 2 pages
    pageNumber?: number;     // For "read page 3" / "go to page 5"
  };
}

/**
 * Voice command parser service
 */
class VoiceCommandParserService {
  /**
   * Regex patterns for local commands.
   * Ordered by priority for matching: questions and explicit page jumps are
   * matched before generic control words so prefix collisions ("go back" vs
   * "go", "explain why" vs "explain") route correctly.
   */
  private readonly commandPatterns: Array<{
    pattern: RegExp;
    type: VoiceCommandType;
    isLocal: boolean;
    numberGroup?: number; // capture group holding a skip amount
    pageGroup?: number;   // capture group holding an explicit page number
  }> = [
    // Repeat commands (before questions so "what did you say" stays a repeat).
    { pattern: /^(repeat|say that again|say again|again|what did you say)\b/i, type: 'REPEAT', isLocal: true },

    // Clear questions (matched early so "explain why ..." stays a question).
    { pattern: /^(what is|what are|why is|why are|why do|how is|how do|how does|when |where |which |who |can you|could you|tell me|explain why|explain how|explain what|define |describe |is |are )/i, type: 'AI_QUERY', isLocal: false },

    // Pause/Stop commands
    { pattern: /^(pause|wait|hold|silence)\b/i, type: 'PAUSE', isLocal: true },
    { pattern: /^(stop|end|quit|exit|halt)\b/i, type: 'STOP', isLocal: true },

    // Next / Back navigation (with optional skip amount)
    { pattern: /^(go to the next page|go to next page|go next|next|continue|skip forward|skip ahead|skip)\b(\s+(\d+))?/i, type: 'NEXT', isLocal: true, numberGroup: 3 },
    { pattern: /^(go back|go to the previous page|go to previous page|back|previous|rewind)\b(\s+(\d+))?/i, type: 'BACK', isLocal: true, numberGroup: 3 },

    // Mode switching
    { pattern: /^(start|open|launch|switch to|go to|move to) (the )?(audio player|player|music player)\b/i, type: 'SWITCH_PLAYER', isLocal: true },
    { pattern: /^(audio player mode|player mode|music mode)\b/i, type: 'SWITCH_PLAYER', isLocal: true },
    { pattern: /^(start|open|launch|switch to|go to|move to) (the )?(ai )?teacher\b/i, type: 'SWITCH_TEACHER', isLocal: true },
    { pattern: /^(ai teacher mode|teacher mode)\b/i, type: 'SWITCH_TEACHER', isLocal: true },

    // Resume commands
    { pattern: /^(resume|play)\b/i, type: 'RESUME', isLocal: true },

    // Explicit "read / go to page N" jumps
    { pattern: /^(?:read|open|go to|show)\s+(?:page\s+)?(\d+)\b/i, type: 'START_TEACHING', isLocal: true, pageGroup: 1 },

    // Summarize commands
    { pattern: /^(summarize|summary|summarise|recap)\b/i, type: 'SUMMARIZE', isLocal: true },

    // Start teaching / confirm teaching
    { pattern: /^(yes|yeah|yep|yup|okay|ok|sure|absolutely|correct|start|begin|go ahead|teach me|teach|explain|let'?s start|let us start|ready|read|go)\b/i, type: 'START_TEACHING', isLocal: true },
  ];

  /**
   * Parse voice command text
   */
  parseCommand(text: string): ParsedVoiceCommand {
    const trimmedText = text.trim().toLowerCase();

    // Try to match against local command patterns
    for (const { pattern, type, isLocal, numberGroup, pageGroup } of this.commandPatterns) {
      const match = trimmedText.match(pattern);
      if (match) {
        const result: ParsedVoiceCommand = {
          type,
          isLocal,
          requiresNetwork: type === 'AI_QUERY',
          originalText: text,
        };

        // Extract parameters if present
        if (numberGroup && match[numberGroup]) {
          result.parameters = { amount: parseInt(match[numberGroup], 10) };
        } else if (pageGroup && match[pageGroup]) {
          result.parameters = { pageNumber: parseInt(match[pageGroup], 10) };
        }

        console.log(`[VoiceCommandParser] Matched local command: ${type}`, result);
        return result;
      }
    }

    // If no local command matched, it's an AI query
    console.log('[VoiceCommandParser] No local command matched, treating as AI query');
    return {
      type: 'AI_QUERY',
      isLocal: false,
      requiresNetwork: true,
      originalText: text,
    };
  }

  /**
   * Process voice command. Always executable locally: navigation is offline by
   * design and topic selection works against the offline catalog, while the AI
   * query path has its own API-key fallback in the teacher engine.
   */
  async processCommand(text: string): Promise<{
    action: ParsedVoiceCommand;
  }> {
    return {
      action: this.parseCommand(text),
    };
  }

  /**
   * Extract page range from voice command
   * e.g., "pages 25 to 47" -> { startPage: 25, endPage: 47 }
   */
  extractPageRange(text: string, totalPages: number): { startPage: number; endPage: number } | null {
    const pageRangePattern = /(?:page|pages)?\s*(\d+)\s*(?:to|through|until|-)\s*(\d+)/i;
    const match = text.match(pageRangePattern);
    
    if (match) {
      const startPage = Math.min(parseInt(match[1], 10), totalPages);
      const endPage = Math.min(parseInt(match[2], 10), totalPages);
      
      if (startPage <= endPage) {
        console.log(`[VoiceCommandParser] Extracted page range: ${startPage} to ${endPage}`);
        return { startPage, endPage };
      }
    }

    return null;
  }

  /**
   * Extract chapter reference from voice command
   * e.g., "chapter 3" -> "chapter 3"
   */
  extractChapter(text: string): string | null {
    const chapterPattern = /chapter\s+(\d+|[a-zA-Z]+)/i;
    const match = text.match(chapterPattern);
    
    if (match) {
      console.log(`[VoiceCommandParser] Extracted chapter: ${match[1]}`);
      return match[1];
    }

    return null;
  }
}

// Export singleton instance
export const voiceCommandParser = new VoiceCommandParserService();
