/**
 * persistence.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistence Service
 * 
 * Manages local storage of application state using AsyncStorage.
 * Persists:
 * - Active document information
 * - Conversation history
 * - User preferences
 * 
 * Implements versioning for data migration and incremental saves.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistentState, ConversationMessage, UserPreferences } from '../types/teacher.types';

const STORAGE_KEYS = {
  ACTIVE_DOCUMENT: '@eduaudio_active_document',
  CONVERSATION_HISTORY: '@eduaudio_conversation_history',
  USER_PREFERENCES: '@eduaudio_user_preferences',
  STORAGE_VERSION: '@eduaudio_storage_version',
};

const CURRENT_STORAGE_VERSION = 1;

/**
 * Persistence Service
 */
export class PersistenceService {
  /**
   * Save the complete application state
   */
  async saveState(state: PersistentState): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.STORAGE_VERSION, CURRENT_STORAGE_VERSION.toString());
      
      if (state.activeDocument) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.ACTIVE_DOCUMENT,
          JSON.stringify(state.activeDocument)
        );
      } else {
        await AsyncStorage.removeItem(STORAGE_KEYS.ACTIVE_DOCUMENT);
      }

      await AsyncStorage.setItem(
        STORAGE_KEYS.CONVERSATION_HISTORY,
        JSON.stringify(state.conversationHistory)
      );

      await AsyncStorage.setItem(
        STORAGE_KEYS.USER_PREFERENCES,
        JSON.stringify(state.userPreferences)
      );

      console.log('[Persistence] State saved successfully');
    } catch (error) {
      console.error('[Persistence] Failed to save state:', error);
      throw new Error(`Failed to save state: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load the complete application state
   */
  async loadState(): Promise<PersistentState | null> {
    try {
      // Check if any data exists
      const version = await AsyncStorage.getItem(STORAGE_KEYS.STORAGE_VERSION);
      if (!version) {
        console.log('[Persistence] No saved state found');
        return null;
      }

      // Migrate if needed
      await this.migrateIfNeeded(parseInt(version, 10));

      // Load active document
      const activeDocumentJson = await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_DOCUMENT);
      const activeDocument = activeDocumentJson 
        ? JSON.parse(activeDocumentJson) 
        : null;

      // Load conversation history
      const conversationHistoryJson = await AsyncStorage.getItem(STORAGE_KEYS.CONVERSATION_HISTORY);
      const conversationHistory = conversationHistoryJson
        ? JSON.parse(conversationHistoryJson)
        : [];

      // Load user preferences
      const userPreferencesJson = await AsyncStorage.getItem(STORAGE_KEYS.USER_PREFERENCES);
      const userPreferences = userPreferencesJson
        ? JSON.parse(userPreferencesJson)
        : this.getDefaultPreferences();

      console.log('[Persistence] State loaded successfully');
      return {
        activeDocument,
        conversationHistory,
        userPreferences,
      };
    } catch (error) {
      console.error('[Persistence] Failed to load state:', error);
      return null;
    }
  }

  /**
   * Clear all saved state
   */
  async clearState(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.ACTIVE_DOCUMENT,
        STORAGE_KEYS.CONVERSATION_HISTORY,
        STORAGE_KEYS.USER_PREFERENCES,
        STORAGE_KEYS.STORAGE_VERSION,
      ]);
      console.log('[Persistence] State cleared successfully');
    } catch (error) {
      console.error('[Persistence] Failed to clear state:', error);
      throw new Error(`Failed to clear state: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Save active document information
   */
  async saveActiveDocument(document: {
    id: string;
    uri: string;
    lastPageNumber: number;
    lastPosition: number;
  }): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.ACTIVE_DOCUMENT,
        JSON.stringify(document)
      );
      console.log('[Persistence] Active document saved');
    } catch (error) {
      console.error('[Persistence] Failed to save active document:', error);
    }
  }

  /**
   * Load active document information
   */
  async loadActiveDocument(): Promise<{
    id: string;
    uri: string;
    lastPageNumber: number;
    lastPosition: number;
  } | null> {
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_DOCUMENT);
      return json ? JSON.parse(json) : null;
    } catch (error) {
      console.error('[Persistence] Failed to load active document:', error);
      return null;
    }
  }

  /**
   * Add a conversation message to history
   */
  async addConversationMessage(
    documentId: string,
    message: ConversationMessage
  ): Promise<void> {
    try {
      const historyJson = await AsyncStorage.getItem(STORAGE_KEYS.CONVERSATION_HISTORY);
      const history = historyJson ? JSON.parse(historyJson) : [];

      // Find or create history for this document
      let docHistory = history.find((h: any) => h.documentId === documentId);
      if (!docHistory) {
        docHistory = {
          documentId,
          messages: [],
          timestamp: Date.now(),
        };
        history.push(docHistory);
      }

      // Add message
      docHistory.messages.push(message);
      docHistory.timestamp = Date.now();

      // Limit to last 50 messages per document
      if (docHistory.messages.length > 50) {
        docHistory.messages = docHistory.messages.slice(-50);
      }

      await AsyncStorage.setItem(
        STORAGE_KEYS.CONVERSATION_HISTORY,
        JSON.stringify(history)
      );

      console.log('[Persistence] Conversation message added');
    } catch (error) {
      console.error('[Persistence] Failed to add conversation message:', error);
    }
  }

  /**
   * Load conversation history for a specific document
   */
  async loadConversationHistory(documentId: string): Promise<ConversationMessage[]> {
    try {
      const historyJson = await AsyncStorage.getItem(STORAGE_KEYS.CONVERSATION_HISTORY);
      const history = historyJson ? JSON.parse(historyJson) : [];

      const docHistory = history.find((h: any) => h.documentId === documentId);
      return docHistory ? docHistory.messages : [];
    } catch (error) {
      console.error('[Persistence] Failed to load conversation history:', error);
      return [];
    }
  }

  /**
   * Save user preferences
   */
  async saveUserPreferences(preferences: UserPreferences): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.USER_PREFERENCES,
        JSON.stringify(preferences)
      );
      console.log('[Persistence] User preferences saved');
    } catch (error) {
      console.error('[Persistence] Failed to save user preferences:', error);
    }
  }

  /**
   * Load user preferences
   */
  async loadUserPreferences(): Promise<UserPreferences> {
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEYS.USER_PREFERENCES);
      return json ? JSON.parse(json) : this.getDefaultPreferences();
    } catch (error) {
      console.error('[Persistence] Failed to load user preferences:', error);
      return this.getDefaultPreferences();
    }
  }

  /**
   * Get default user preferences
   */
  private getDefaultPreferences(): UserPreferences {
    return {
      speechRate: 1.0,
      voicePreference: '',
      autoResume: true,
      hapticFeedback: true,
    };
  }

  /**
   * Migrate data if storage version is outdated
   */
  private async migrateIfNeeded(currentVersion: number): Promise<void> {
    if (currentVersion >= CURRENT_STORAGE_VERSION) {
      return;
    }

    console.log(`[Persistence] Migrating from version ${currentVersion} to ${CURRENT_STORAGE_VERSION}`);

    try {
      // Implement migration logic here
      // Example: if migrating from version 0 to 1
      if (currentVersion === 0) {
        // Migration logic for version 0 -> 1
        await this.migrateFrom0To1();
      }

      // Update version
      await AsyncStorage.setItem(STORAGE_KEYS.STORAGE_VERSION, CURRENT_STORAGE_VERSION.toString());
      console.log('[Persistence] Migration completed');
    } catch (error) {
      console.error('[Persistence] Migration failed:', error);
    }
  }

  /**
   * Migration from version 0 to 1
   */
  private async migrateFrom0To1(): Promise<void> {
    // Example migration: restructure conversation history format
    console.log('[Persistence] Executing migration 0 -> 1');
    // Add specific migration logic here
  }
}

// Export singleton instance
export const persistenceService = new PersistenceService();
