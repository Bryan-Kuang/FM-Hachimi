/**
 * Concurrent extract + voice-join orchestration shared by every "play from URL"
 * path (Bilibili via AudioManager, YouTube via the coordinator).
 *
 * Extraction (yt-dlp) and the Discord voice handshake are independent, so we run
 * them at the same time and only block on both at the end. This helper owns the
 * fiddly parts that were previously copy-pasted per platform: stage reporting,
 * per-phase timing, settling both promises without losing the first error, and
 * the "leave the channel again if we only joined to play this failed track"
 * cleanup. Callers supply a platform-specific `extract` closure and handle the
 * post-extraction steps (queue + playback) themselves.
 */

import { emitPlaybackStage, type PlaybackStageReporter } from './stage_feedback';
import * as logger from '../services/logger_service';
import type { ExtractedTrackData } from '../services/types';

/** Minimal player surface this helper touches. */
export interface ExtractJoinPlayer {
  isPlaying: boolean;
  isPaused: boolean;
  voiceConnection?: { joinConfig?: { channelId?: string } } | null;
  joinVoiceChannel(channel: unknown): Promise<boolean>;
  leaveVoiceChannel?(): void;
}

export interface ExtractJoinOptions {
  player: ExtractJoinPlayer;
  voiceChannel: { id?: string } & Record<string, unknown>;
  /** Platform-specific extraction. Receives the stage reporter to forward. */
  extract: (onStage?: PlaybackStageReporter) => Promise<ExtractedTrackData>;
  onStage?: PlaybackStageReporter;
  /** Extra fields merged into the timing log line (guild, user, …). */
  logContext?: Record<string, unknown>;
  /** Log label, e.g. "Bilibili direct playback timing". */
  logLabel: string;
}

export type ExtractJoinResult =
  | { ok: true; videoData: ExtractedTrackData; timings: Record<string, number>; logTiming: LogTiming }
  | { ok: false; error: string; failedStage: 'extraction' | 'voiceJoin' };

type LogTiming = (success: boolean, extra?: Record<string, unknown>) => void;

/**
 * Run extraction and voice-join concurrently. On success returns the extracted
 * data plus the accumulated timings and a `logTiming` callback the caller uses
 * to close out the timing log once playback has (or hasn't) started.
 */
export async function extractAndJoin({
  player,
  voiceChannel,
  extract,
  onStage,
  logContext = {},
  logLabel,
}: ExtractJoinOptions): Promise<ExtractJoinResult> {
  const reportStage = (
    stage: Parameters<typeof emitPlaybackStage>[1],
    details?: Parameters<typeof emitPlaybackStage>[2],
  ) => emitPlaybackStage(onStage, stage, details);

  reportStage('preparing');

  const totalStartedAt = Date.now();
  const timings: Record<string, number> = {};
  const logTiming: LogTiming = (success, extra = {}) => {
    timings.totalMs = Date.now() - totalStartedAt;
    logger.info(logLabel, { ...logContext, success, ...timings, ...extra });
  };
  const timed = async <T>(stage: string, promise: Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      return await promise;
    } finally {
      timings[stage] = Date.now() - startedAt;
    }
  };
  const settle = async <T>(
    promise: Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: Error }> => {
    try {
      return { ok: true, value: await promise };
    } catch (error: unknown) {
      return { ok: false, error: error as Error };
    }
  };

  const wasActiveBeforeCommand = Boolean(player.isPlaying || player.isPaused);
  const hadVoiceConnectionBeforeCommand = Boolean(player.voiceConnection);
  const targetChannelId = voiceChannel.id;
  const needsVoiceJoin =
    !player.voiceConnection ||
    player.voiceConnection.joinConfig?.channelId !== targetChannelId;

  reportStage('extracting');
  const extractionPromise = timed('extractionMs', extract(onStage));
  if (needsVoiceJoin) {
    reportStage('joining_voice');
  }
  const joinPromise = needsVoiceJoin
    ? timed('voiceJoinMs', player.joinVoiceChannel(voiceChannel))
    : Promise.resolve(true);

  const [extractionResult, joinResult] = await Promise.all([
    settle(extractionPromise),
    settle(joinPromise),
  ]);

  if (!extractionResult.ok) {
    // Only undo the join if we created it solely for this failed track — never
    // tear down a connection that was already serving active playback.
    if (
      joinResult.ok &&
      joinResult.value &&
      needsVoiceJoin &&
      !wasActiveBeforeCommand &&
      !hadVoiceConnectionBeforeCommand
    ) {
      player.leaveVoiceChannel?.();
    }
    reportStage('failed', { stage: 'extraction' });
    logTiming(false, { failedStage: 'extraction' });
    return { ok: false, error: extractionResult.error.message, failedStage: 'extraction' };
  }

  if (!joinResult.ok || !joinResult.value) {
    reportStage('failed', { stage: 'voiceJoin' });
    logTiming(false, { failedStage: 'voiceJoin' });
    return { ok: false, error: 'Failed to join voice channel', failedStage: 'voiceJoin' };
  }

  return { ok: true, videoData: extractionResult.value, timings, logTiming };
}
