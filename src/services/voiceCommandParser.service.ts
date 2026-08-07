/**
 * voiceCommandParser.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Voice Command Parser Service
 * 
 * Parses voice input using regex patterns to identify local control commands
 * vs. AI queries. Handles offline fallback for network-dependent operations.
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Network from 'expo-network';

/**
 * Voice command types
 */
export type VoiceCommandType =
  | 'PAUSE'           // Pause playback
  | 'STOP'            // Stop playback
  | 'RESUME'          // Resume playback
  | 'NEXT'            // Skip to next paragraph/page
  | 'BACK'            // Go back to previous paragraph/page
  | 'REPEAT'          // Repeat current content
  | 'AI_QUERY'        // Query requiring AI processing
  | 'UNKNOWN';        // Unrecognized command

/**
 * Parsed voice command result
 */
export interface ParsedVoiceCommand {
  type: VoiceCommandType;
  isLocal: boolean;           // Can be executed offline
  requiresNetwork: boolean;   // Requires network connection
  originalText: string;
  parameters?: {
    amount?: number;         // For "next 2 paragraphs"
    target?: string;         // For "go to chapter 3"
  };
}

/**
 * Voice command parser service
 */
class VoiceCommandParserService {
  /**
   * Regex patterns for local commands
   * Ordered by priority for matching
   */
  private readonly commandPatterns: Array<{
    pattern: RegExp;
    type: VoiceCommandType;
    isLocal: boolean;
  }> = [
    // Pause/Stop commands
    { pattern: /^(pause|stop|halt|wait|hold)\b/i, type: 'PAUSE', isLocal: true },
    { pattern: /^(stop|end|quit|exit)\b/i, type: 'STOP', isLocal: true },
    
    // Resume commands
    { pattern: /^(resume|continue|play|start|go)\b/i, type: 'RESUME', isLocal: true },
    
    // Navigation commands
    { pattern: /^(next|skip|forward|ahead)\b(\s+(\d+))?/i, type: 'NEXT', isLocal: true },
    { pattern: /^(back|previous|rewind|go back)\b(\s+(\d+))?/i, type: 'BACK', isLocal: true },
    
    // Repeat commands
    { pattern: /^(repeat|again|say that again|what did you say)\b/i, type: 'REPEAT', isLocal: true },
  ];

  /**
   * Check if device is online
   */
  async isOnline(): Promise<boolean> {
    try {
      const networkState = await Network.getNetworkStateAsync();
      return !!networkState.isConnected && networkState.type !== Network.NetworkStateType.NONE;
    } catch (error) {
      console.error('[VoiceCommandParser] Network check failed:', error);
      return false; // Assume offline if check fails
    }
  }

  /**
   * Parse voice command text
   */
  parseCommand(text: string): ParsedVoiceCommand {
    const trimmedText = text.trim().toLowerCase();
    
    // Try to match against local command patterns
    for (const { pattern, type, isLocal } of this.commandPatterns) {
      const match = trimmedText.match(pattern);
      if (match) {
        const result: ParsedVoiceCommand = {
          type,
          isLocal,
          requiresNetwork: false,
          originalText: text,
        };

        // Extract parameters if present
        if (match[3]) {
          result.parameters = {
            amount: parseInt(match[3], 10),
          };
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
   * Process voice command with network awareness
   * Returns the action to take and any offline message if needed
   */
  async processCommand(text: string): Promise<{
    action: ParsedVoiceCommand;
    offlineMessage?: string;
  }> {
    const command = this.parseCommand(text);
    const isOnline = await this.isOnline();

    // If command requires network but we're offline
    if (command.requiresNetwork && !isOnline) {
      console.log('[VoiceCommandParser] AI query detected while offline');
      return {
        action: command,
        offlineMessage: 'I am currently offline, but I can keep reading your document. I will answer your questions as soon as you reconnect.',
      };
    }

    // Command can be executed
    return {
      action: command,
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
