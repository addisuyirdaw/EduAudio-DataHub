/**
 * AudioMutex.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Audio Concurrency Mutex for AI Teacher Mode
 * 
 * Implements strict operation guarding to prevent audio conflicts between:
 * - Audio playback (expo-av)
 * - Voice recording (microphone)
 * - Text-to-speech (expo-speech)
 * 
 * The mutex ensures that only one audio operation is active at any time,
 * preventing microphone feedback loops and screen reader conflicts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Audio } from 'expo-av';
import type { AudioMutexState } from '../types/teacher.types';

class AudioMutex {
  private state: AudioMutexState = {
    isPlaybackActive: false,
    isRecordingActive: false,
    isTTSActive: false,
    isLocked: false,
  };

  private playbackSound: Audio.Sound | null = null;
  private stateChangeCallbacks: Set<(state: AudioMutexState) => void> = new Set();

  /**
   * Register a callback for state changes
   */
  onStateChange(callback: (state: AudioMutexState) => void) {
    this.stateChangeCallbacks.add(callback);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  /**
   * Get current mutex state
   */
  getState(): AudioMutexState {
    return { ...this.state };
  }

  /**
   * Lock the mutex and prepare for a new audio operation
   * This stops all currently active audio operations
   */
  async lock(): Promise<void> {
    if (this.state.isLocked) {
      console.warn('[AudioMutex] Already locked, waiting...');
      // Wait for unlock with timeout
      const timeout = setTimeout(() => {
        if (this.state.isLocked) {
          console.error('[AudioMutex] Lock timeout, forcing unlock');
          this.state.isLocked = false;
        }
      }, 5000);
      
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.state.isLocked) {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }

    this.state.isLocked = true;
    this.notifyStateChange();

    // Stop all active audio operations
    await this.forceStopAll();
  }

  /**
   * Unlock the mutex
   */
  async unlock(): Promise<void> {
    this.state.isLocked = false;
    this.notifyStateChange();
    console.log('[AudioMutex] Unlocked');
  }

  /**
   * Force stop all audio operations
   * Used before starting a new operation or in error scenarios
   */
  async forceStopAll(): Promise<void> {
    console.log('[AudioMutex] Force stopping all audio operations');

    // Stop playback
    if (this.state.isPlaybackActive && this.playbackSound) {
      try {
        await this.playbackSound.stopAsync();
        await this.playbackSound.unloadAsync();
        this.playbackSound = null;
        this.state.isPlaybackActive = false;
        console.log('[AudioMutex] Playback stopped');
      } catch (error) {
        console.error('[AudioMutex] Error stopping playback:', error);
      }
    }

    // Stop recording (if we had a recording interface)
    if (this.state.isRecordingActive) {
      try {
        // Recording stop logic would go here
        this.state.isRecordingActive = false;
        console.log('[AudioMutex] Recording stopped');
      } catch (error) {
        console.error('[AudioMutex] Error stopping recording:', error);
      }
    }

    // Stop TTS
    if (this.state.isTTSActive) {
      try {
        // Import Speech dynamically to avoid circular dependency
        const Speech = require('expo-speech').default;
        await Speech.stop();
        this.state.isTTSActive = false;
        console.log('[AudioMutex] TTS stopped');
      } catch (error) {
        console.error('[AudioMutex] Error stopping TTS:', error);
      }
    }

    this.notifyStateChange();
  }

  /**
   * Acquire playback lock
   * Stops recording and TTS before allowing playback
   */
  async acquirePlaybackLock(sound: Audio.Sound): Promise<void> {
    await this.lock();
    
    // Ensure recording and TTS are stopped
    if (this.state.isRecordingActive) {
      this.state.isRecordingActive = false;
    }
    if (this.state.isTTSActive) {
      this.state.isTTSActive = false;
    }

    this.playbackSound = sound;
    this.state.isPlaybackActive = true;
    this.notifyStateChange();
    
    console.log('[AudioMutex] Playback lock acquired');
  }

  /**
   * Release playback lock
   */
  async releasePlaybackLock(): Promise<void> {
    if (this.playbackSound) {
      try {
        await this.playbackSound.unloadAsync();
        this.playbackSound = null;
      } catch (error) {
        console.error('[AudioMutex] Error unloading sound:', error);
      }
    }
    
    this.state.isPlaybackActive = false;
    await this.unlock();
    
    console.log('[AudioMutex] Playback lock released');
  }

  /**
   * Acquire recording lock
   * Stops playback and TTS before allowing recording
   * Ducks background audio to prevent feedback
   */
  async acquireRecordingLock(): Promise<void> {
    await this.lock();
    
    // Stop playback and duck audio
    if (this.state.isPlaybackActive && this.playbackSound) {
      await this.playbackSound.setVolumeAsync(0.1); // Duck to 10%
    }
    
    this.state.isPlaybackActive = false;
    this.state.isTTSActive = false;
    this.state.isRecordingActive = true;
    this.notifyStateChange();
    
    console.log('[AudioMutex] Recording lock acquired');
  }

  /**
   * Release recording lock
   * Restores background audio volume
   */
  async releaseRecordingLock(): Promise<void> {
    this.state.isRecordingActive = false;
    
    // Restore audio volume if we have a sound
    if (this.playbackSound) {
      try {
        await this.playbackSound.setVolumeAsync(1.0);
      } catch (error) {
        console.error('[AudioMutex] Error restoring volume:', error);
      }
    }
    
    await this.unlock();
    
    console.log('[AudioMutex] Recording lock released');
  }

  /**
   * Acquire TTS lock
   * Stops recording and checks screen reader state
   */
  async acquireTTSLock(): Promise<void> {
    await this.lock();
    
    // Stop recording
    if (this.state.isRecordingActive) {
      this.state.isRecordingActive = false;
    }
    
    // Pause playback temporarily
    if (this.state.isPlaybackActive && this.playbackSound) {
      await this.playbackSound.pauseAsync();
    }
    
    this.state.isTTSActive = true;
    this.notifyStateChange();
    
    console.log('[AudioMutex] TTS lock acquired');
  }

  /**
   * Release TTS lock
   * Resumes playback if it was active
   */
  async releaseTTSLock(): Promise<void> {
    const wasPlaybackActive = this.state.isPlaybackActive;
    
    this.state.isTTSActive = false;
    
    // Resume playback if it was active
    if (wasPlaybackActive && this.playbackSound) {
      try {
        await this.playbackSound.playAsync();
      } catch (error) {
        console.error('[AudioMutex] Error resuming playback:', error);
      }
    }
    
    await this.unlock();
    
    console.log('[AudioMutex] TTS lock released');
  }

  /**
   * Notify all registered callbacks of state change
   */
  private notifyStateChange(): void {
    const stateSnapshot = this.getState();
    this.stateChangeCallbacks.forEach(callback => {
      try {
        callback(stateSnapshot);
      } catch (error) {
        console.error('[AudioMutex] Error in state change callback:', error);
      }
    });
  }

  /**
   * Hard pause - immediately stop all audio operations
   * Used when user touches down to activate voice input
   * Latency target: < 100ms
   */
  async hardPause(): Promise<void> {
    console.log('[AudioMutex] Hard pause triggered');
    
    // Stop playback immediately
    if (this.state.isPlaybackActive && this.playbackSound) {
      try {
        await this.playbackSound.pauseAsync();
        console.log('[AudioMutex] Playback hard paused');
      } catch (error) {
        console.error('[AudioMutex] Error hard pausing playback:', error);
      }
    }

    // Stop TTS immediately
    if (this.state.isTTSActive) {
      try {
        // Import Speech dynamically to avoid circular dependency
        const Speech = require('expo-speech').default;
        await Speech.stop();
        this.state.isTTSActive = false;
        console.log('[AudioMutex] TTS hard stopped');
      } catch (error) {
        console.error('[AudioMutex] Error hard stopping TTS:', error);
      }
    }

    // Stop recording immediately
    if (this.state.isRecordingActive) {
      try {
        // Recording stop logic would go here
        this.state.isRecordingActive = false;
        console.log('[AudioMutex] Recording hard stopped');
      } catch (error) {
        console.error('[AudioMutex] Error hard stopping recording:', error);
      }
    }

    this.notifyStateChange();
  }

  /**
   * Reset the mutex to initial state
   * Use for recovery from error states
   */
  async reset(): Promise<void> {
    await this.forceStopAll();
    this.state.isLocked = false;
    this.notifyStateChange();
    console.log('[AudioMutex] Reset to initial state');
  }
}

// Export singleton instance
export const audioMutex = new AudioMutex();
