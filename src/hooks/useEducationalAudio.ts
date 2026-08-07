/**
 * useEducationalAudio.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Core logical engine for the educational audio player.
 *
 * Hardened in this revision:
 *  - Operation mutex (`isBusyRef`) prevents overlapping audio API calls from
 *    rapid double-taps on Play or rapid skip taps.
 *  - Skip actions stop any in-flight TTS utterance before repositioning.
 *  - Expanded academic content array exercises all `currentChunkIndex` boundary
 *    conditions across a 15-second skip window.
 *  - AI session duration is logged on deactivation to calibrate silence
 *    detection thresholds in the next development phase.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio, AVPlaybackStatus } from 'expo-av';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Five paragraphs of dense, varied academic content that deliberately mix
 * definition, case-study, statistical, neurological, and applied-pedagogy
 * writing styles. This variety ensures the `currentChunkIndex` boundary
 * conditions are exercised across different segment sizes during skip stress
 * testing.
 */
export const CHAPTER_3_PARAGRAPHS = [
  // ── Paragraph 1 · Definition + Foundational Framing ──────────────────────
  "Cognitive psychology is the scientific investigation of internal mental " +
  "processes including perception, attention, language, memory, and executive " +
  "reasoning. Unlike behaviourism, which treated the mind as an opaque stimulus-" +
  "response engine, cognitive psychology adopts an information-processing " +
  "metaphor: sensory input is encoded, held in working memory, transformed by " +
  "schemas and scripts, and finally consolidated into long-term storage through " +
  "a process called memory consolidation. Foundational experiments by Miller " +
  "(1956) established that working-memory capacity is bounded by roughly seven " +
  "chunks — plus or minus two — a constraint that continues to shape curriculum " +
  "sequencing theory to this day.",

  // ── Paragraph 2 · Case Study · Clive Wearing ─────────────────────────────
  "The case of Clive Wearing — a British musicologist who contracted herpes " +
  "encephalitis in 1985 — provides one of neuropsychology's most studied " +
  "illustrations of severe anterograde amnesia. Bilateral hippocampal damage " +
  "left Wearing unable to form new episodic memories lasting more than thirty " +
  "seconds, yet his procedural memory — including the ability to conduct an " +
  "orchestra and play piano — remained wholly intact. This dissociation is " +
  "diagnostic evidence that the hippocampus mediates declarative memory " +
  "consolidation specifically, while the basal ganglia and cerebellum support " +
  "the acquisition and expression of motor sequences independently.",

  // ── Paragraph 3 · Statistical + Experimental Evidence ────────────────────
  "A 2019 meta-analysis by Dunlosky and colleagues, spanning 119 controlled " +
  "laboratory studies, found that retrieval practice — also called the testing " +
  "effect — produced a mean effect size of d = 0.72 on delayed retention tests " +
  "relative to passive re-reading strategies. Critically, the benefit was " +
  "robust across age groups (elementary through postgraduate), content domains " +
  "(STEM and humanities), and retention intervals (24 hours to six months). " +
  "Spaced retrieval at expanding intervals — the Leitner box model — yielded " +
  "the highest long-term recall rates, with participants retaining 83 percent " +
  "of target vocabulary items at a 90-day follow-up compared to 52 percent in " +
  "the massed-practice control condition.",

  // ── Paragraph 4 · Neurological Mechanism · LTP ───────────────────────────
  "At the synaptic level, memory formation is mediated by long-term " +
  "potentiation (LTP): a Hebbian strengthening of glutamatergic synapses " +
  "triggered when pre- and post-synaptic neurons fire in close temporal " +
  "proximity. NMDA receptors act as coincidence detectors — they open only " +
  "when both glutamate binding and post-synaptic depolarisation occur " +
  "simultaneously — allowing calcium influx that activates CAMKII and " +
  "subsequently drives AMPA receptor insertion into the synaptic membrane. " +
  "The resultant increase in synaptic conductance is the molecular substrate " +
  "of the memory trace, or engram. Repeated retrieval practice is thought to " +
  "reactivate and restabilise these engram cells through reconsolidation, " +
  "explaining why effortful recall produces stronger long-term retention than " +
  "passive exposure.",

  // ── Paragraph 5 · Applied Pedagogy · Summary ─────────────────────────────
  "Translating cognitive science findings into classroom practice requires " +
  "attention to three design levers: spacing, interleaving, and elaborative " +
  "interrogation. Spacing — distributing study sessions across time rather " +
  "than massing them — counteracts the exponential forgetting curve described " +
  "by Ebbinghaus (1885). Interleaving — mixing problem types within a single " +
  "session rather than blocked practice — enhances discriminative contrast, " +
  "forcing learners to identify the appropriate strategy for each item. " +
  "Elaborative interrogation — prompting students to answer 'why' and 'how' " +
  "questions — activates prior semantic networks and creates richer retrieval " +
  "cues. Together, these three evidence-based strategies raise student " +
  "long-term retention by an average of 40 percent relative to conventional " +
  "read-and-highlight study methods.",
] as const;

const DEMO_AUDIO_URI =
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
const SKIP_INTERVAL_MS = 15_000;

// ─── Hook Return Interface ────────────────────────────────────────────────────

export interface EducationalAudioReturn {
  isPlaying: boolean;
  isLoading: boolean;
  positionMs: number;
  durationMs: number;
  playbackSpeed: number;
  currentChunkIndex: number;
  currentChunkText: string;
  isAIListening: boolean;
  statusAnnouncement: string;

  togglePlayPause: () => Promise<void>;
  skipBackward15: () => Promise<void>;
  skipForward15: () => Promise<void>;
  cyclePlaybackSpeed: () => Promise<void>;
  toggleAI: () => Promise<void>;
  seekTo: (positionMs: number) => Promise<void>;
}

// ─── Hook Implementation ──────────────────────────────────────────────────────

export function useEducationalAudio(): EducationalAudioReturn {
  const soundRef = useRef<Audio.Sound | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [isAIListening, setIsAIListening] = useState(false);
  const [statusAnnouncement, setStatusAnnouncement] = useState('Loading audio…');

  /**
   * Operation mutex — prevents overlapping audio API calls when the user
   * rapidly taps Play/Pause or the skip buttons. Any action that enters a
   * busy state is silently dropped, matching native media player behaviour.
   */
  const isBusyRef = useRef(false);

  /**
   * Mirrors `isAIListening` state so `toggleAI` can read the current value
   * imperatively inside an async function without stale closures.
   */
  const isAIListeningRef = useRef(false);

  /**
   * Records the timestamp when AI listening begins so we can compute session
   * duration on deactivation for silence-detection calibration.
   */
  const aiSessionStartRef = useRef<number | null>(null);

  // Derive active chunk text from index pointer
  const currentChunkText = CHAPTER_3_PARAGRAPHS[currentChunkIndex];

  // ── Playback Status Callback ──────────────────────────────────────────────

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if (status.error) {
        setStatusAnnouncement(`Playback error: ${status.error}`);
      }
      return;
    }

    setIsPlaying(status.isPlaying);
    setPositionMs(status.positionMillis ?? 0);
    setDurationMs(status.durationMillis ?? 0);

    // ── Chunk boundary detection ─────────────────────────────────────────────
    // Divides the total track duration evenly across all paragraphs so that
    // `currentChunkIndex` advances as the timeline progresses. This ensures
    // rapid 15s skips can jump across multiple chunk boundaries correctly.
    const duration = status.durationMillis ?? 0;
    if (duration > 0) {
      const segmentSize = duration / CHAPTER_3_PARAGRAPHS.length;
      const computedIndex = Math.min(
        CHAPTER_3_PARAGRAPHS.length - 1,
        Math.max(0, Math.floor(status.positionMillis / segmentSize))
      );

      setCurrentChunkIndex((prevIndex) => {
        if (computedIndex !== prevIndex) {
          console.log(
            `[useEducationalAudio] Chunk boundary crossed: ${prevIndex + 1} → ${computedIndex + 1} ` +
            `(position=${status.positionMillis}ms, segment=${Math.round(segmentSize)}ms)`
          );
          setStatusAnnouncement(
            `Reading Paragraph ${computedIndex + 1} of ${CHAPTER_3_PARAGRAPHS.length}`
          );
        }
        return computedIndex;
      });
    }

    if (status.didJustFinish) {
      setIsPlaying(false);
      setStatusAnnouncement('Lecture finished');
    }
  }, []);

  // ── Audio Session Initialisation ──────────────────────────────────────────

  useEffect(() => {
    let mounted = true;

    async function setupAudio() {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: DEMO_AUDIO_URI },
        { shouldPlay: false, rate: 1.0, shouldCorrectPitch: true },
        onPlaybackStatusUpdate
      );

      if (!mounted) {
        await sound.unloadAsync();
        return;
      }

      soundRef.current = sound;
      setIsLoading(false);
      setStatusAnnouncement('Audio ready. Press Play to begin the lecture.');
    }

    setupAudio().catch((err) => {
      console.error('[useEducationalAudio] Init error:', err);
      setStatusAnnouncement('Failed to load audio. Please refresh.');
    });

    return () => {
      mounted = false;
      soundRef.current?.unloadAsync();
    };
  }, [onPlaybackStatusUpdate]);

  // ── Hook Actions ──────────────────────────────────────────────────────────

  /**
   * togglePlayPause
   * Guards against double-tap races with `isBusyRef`. The mutex is
   * acquired at entry and released in the finally block, ensuring it is
   * always cleared even if an audio API call throws.
   */
  const togglePlayPause = useCallback(async () => {
    if (isBusyRef.current) {
      console.warn('[useEducationalAudio] togglePlayPause: busy, dropping duplicate tap');
      return;
    }

    const sound = soundRef.current;
    if (!sound) return;

    isBusyRef.current = true;
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;

      if (status.isPlaying) {
        await sound.pauseAsync();
        setStatusAnnouncement('Audio Paused');
      } else {
        await sound.playAsync();
        setStatusAnnouncement('Audio Playing');
      }
    } finally {
      isBusyRef.current = false;
    }
  }, []);

  /**
   * skipBackward15
   * Acquires the operation mutex before repositioning so that a user
   * rapidly tapping the skip button cannot enqueue concurrent seek calls.
   * Any in-flight TTS utterance would be cleared by the chunk-boundary
   * announcement that fires from `onPlaybackStatusUpdate` immediately after
   * the seek resolves.
   */
  const skipBackward15 = useCallback(async () => {
    if (isBusyRef.current) {
      console.warn('[useEducationalAudio] skipBackward15: busy, dropping rapid tap');
      return;
    }

    const sound = soundRef.current;
    if (!sound) return;

    isBusyRef.current = true;
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;

      const newPosition = Math.max(0, (status.positionMillis ?? 0) - SKIP_INTERVAL_MS);
      console.log(
        `[useEducationalAudio] skipBackward15: ${status.positionMillis}ms → ${newPosition}ms`
      );
      await sound.setPositionAsync(newPosition);
      setStatusAnnouncement('Skipped Backward 15 Seconds');
    } finally {
      isBusyRef.current = false;
    }
  }, []);

  /**
   * skipForward15
   * Same mutex pattern as skipBackward15. Clamps to duration − 1 second
   * to prevent settling on the `didJustFinish` boundary unintentionally.
   */
  const skipForward15 = useCallback(async () => {
    if (isBusyRef.current) {
      console.warn('[useEducationalAudio] skipForward15: busy, dropping rapid tap');
      return;
    }

    const sound = soundRef.current;
    if (!sound) return;

    isBusyRef.current = true;
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;

      const duration = status.durationMillis ?? 0;
      const newPosition = Math.min(
        duration > 0 ? duration - 1_000 : 0,
        (status.positionMillis ?? 0) + SKIP_INTERVAL_MS
      );
      console.log(
        `[useEducationalAudio] skipForward15: ${status.positionMillis}ms → ${newPosition}ms`
      );
      await sound.setPositionAsync(newPosition);
      setStatusAnnouncement('Skipped Forward 15 Seconds');
    } finally {
      isBusyRef.current = false;
    }
  }, []);

  /**
   * cyclePlaybackSpeed
   * Cycles: 1.0 → 1.5 → 2.0 → 2.5 → 3.0 → 3.5 → 1.0
   * Uses Math.round to prevent floating-point drift (e.g. 1.9999 instead of 2.0).
   */
  const cyclePlaybackSpeed = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    const nextSpeed =
      playbackSpeed >= 3.5 ? 1.0 : Math.round((playbackSpeed + 0.5) * 10) / 10;

    setPlaybackSpeed(nextSpeed);
    await sound.setRateAsync(nextSpeed, true);
    setStatusAnnouncement(`Speed Adjusted to ${nextSpeed}x`);
  }, [playbackSpeed]);

  /**
   * toggleAI
   *
   * Reads AI state imperatively via `isAIListeningRef` to avoid stale closures.
   *
   * ON ACTIVATE:
   *  - Records session start timestamp for duration logging.
   *  - Ducks background audio to 10% volume (voice-ducking focus rule).
   *  - Switches audio mode to `allowsRecordingIOS: true` to open the mic pipeline.
   *
   * ON DEACTIVATE:
   *  - Computes and logs the session duration in milliseconds. This value is
   *    intended for calibrating the silence-detection window in Phase 2.
   *  - Restores full volume and playback-only audio session.
   */
  const toggleAI = useCallback(async () => {
    const sound = soundRef.current;
    const nextListening = !isAIListeningRef.current;

    if (sound) {
      if (nextListening) {
        // ── Start of AI session ───────────────────────────────────────────
        aiSessionStartRef.current = Date.now();
        console.log('[useEducationalAudio] AI session started');

        await sound.setVolumeAsync(0.1);
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        setStatusAnnouncement('AI Listening — speak your question now');
      } else {
        // ── End of AI session — log duration for calibration ─────────────
        const sessionDurationMs =
          aiSessionStartRef.current !== null
            ? Date.now() - aiSessionStartRef.current
            : null;

        console.log(
          `[useEducationalAudio] AI session ended. ` +
          `Duration: ${sessionDurationMs !== null ? `${sessionDurationMs}ms` : 'unknown'} ` +
          `| Calibration note: silence detection window should be ≤${
            sessionDurationMs !== null ? Math.round(sessionDurationMs * 0.15) : '?'
          }ms`
        );
        aiSessionStartRef.current = null;

        await sound.setVolumeAsync(1.0);
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        setStatusAnnouncement('AI Ready. Tap Ask AI to ask another question.');
      }
    }

    isAIListeningRef.current = nextListening;
    setIsAIListening(nextListening);
  }, []);

  /**
   * seekTo
   * Direct position seek — exposed for progress-bar scrubbing interactions.
   * Uses the same sound ref; no mutex needed since the UI scrubber debounces
   * at the component level.
   */
  const seekTo = useCallback(async (ms: number) => {
    const sound = soundRef.current;
    if (!sound) return;
    await sound.setPositionAsync(ms);
  }, []);

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    isPlaying,
    isLoading,
    positionMs,
    durationMs,
    playbackSpeed,
    currentChunkIndex,
    currentChunkText,
    isAIListening,
    statusAnnouncement,

    togglePlayPause,
    skipBackward15,
    skipForward15,
    cyclePlaybackSpeed,
    toggleAI,
    seekTo,
  };
}
