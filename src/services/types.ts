/**
 * Service Layer Interfaces
 * Defines the contracts between PlayerService and its dependencies.
 * Keeps coupling loose — AudioManager, InterfaceUpdater, etc. only need to
 * satisfy these duck-types rather than concrete class imports.
 */

import type Track from '../models/track';
import type { GuildId, ChannelId, MessageId } from '../types';

// ─── AudioPlayer state snapshot (returned by AudioPlayer.getState()) ──────

export interface AudioPlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  isIdle: boolean;
  currentTrack: Track | null;
  currentIndex: number;
  queue: Track[];
  queueLength: number;
  hasNext: boolean;
  hasPrevious: boolean;
  loopMode: string;
  volume: number;
  connected: boolean;
}

// ─── AudioPlayer duck-type (subset PlayerService actually uses) ───────────

export interface AudioPlayerLike {
  isPlaying: boolean;
  isPaused: boolean;
  currentTrack: Track | null;
  currentIndex: number;
  loopMode: string;
  readonly queue: { items: Track[]; length: number };

  getState(): AudioPlayerState;
  playNext(): Promise<boolean>;
  playCurrentTrack(): Promise<boolean>;
  addToQueue(data: ExtractedTrackData, requestedBy: string): Track;
  removeFromQueue(index: number): boolean;
  clearQueue(): void;
  shuffleQueue(): void;
  setLoopMode(mode: string): void;
  leaveVoiceChannel(): void;
  getCurrentTime(): number;
}

// ─── AudioManager duck-type ──────────────────────────────────────────────

export interface PlayResult {
  success: boolean;
  error?: string;
  suggestion?: string;
  keepConnection?: boolean;
  track?: unknown;
  player?: unknown;
  isNewTrack?: boolean;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  suggestion?: string;
  player?: unknown;
  newTrack?: unknown;
  mode?: string;
  showMenu?: boolean;
  showQueue?: boolean;
  message?: string;
}

export interface QueueInfo {
  queue: unknown[];
  currentTrack: unknown;
  state: unknown;
}

export interface AudioManagerLike {
  getPlayer(guildId: GuildId): AudioPlayerLike;
  playBilibiliVideo(interaction: unknown, url: string, options?: unknown): Promise<PlayResult>;
  pausePlayback(guildId: GuildId): ActionResult;
  resumePlayback(guildId: GuildId): ActionResult;
  skipTrack(guildId: GuildId): Promise<ActionResult>;
  previousTrack(guildId: GuildId): Promise<ActionResult>;
  stopPlayback(guildId: GuildId): Promise<ActionResult>;
  shuffleQueue(guildId: GuildId): ActionResult;
  setLoopMode(guildId: GuildId, mode: string): ActionResult;
  getQueue(guildId: GuildId): QueueInfo;
  handleButtonInteraction(interaction: unknown): Promise<ActionResult>;
}

// ─── InterfaceUpdater duck-type ──────────────────────────────────────────

export interface InterfaceUpdaterLike {
  setClient(client: unknown): void;
  bind(playerControl: unknown): void;
  setPlaybackContext(guildId: GuildId, channelId: ChannelId, messageId?: MessageId | null): void;
  clearContext(guildId: GuildId): void;
  hasContext(guildId: GuildId): boolean;
  getContext(guildId: GuildId): { channelId: string; messageId: string } | null;
}

// ─── Extractor duck-type ──────────────────────────────────────────────────

/** Minimal shape an extractor must satisfy for PlayerService. */
export interface ExtractorLike {
  extractAudio(url: string): Promise<ExtractedTrackData>;
  searchVideos(keyword: string, limit?: number): Promise<SearchResultResponse>;
  getAudioStreamUrl(normalizedUrl: string): Promise<string>;
}

/** Data returned by the extractor — superset of what Track needs. */
export interface ExtractedTrackData {
  title: string;
  audioUrl: string;
  duration: number;
  platform?: 'bilibili' | 'youtube';
  url?: string;
  originalUrl?: string;
  normalizedUrl?: string;
  extractedAt?: string;
  extractionMethod?: 'native' | 'ytdlp' | 'ytdlp_fallback' | 'cache';
  extractionTiming?: Record<string, number | string | boolean | undefined>;
  formatId?: string;
  protocol?: string;
  audioCodec?: string;
  videoCodec?: string;
}

export interface SearchResultResponse {
  success: boolean;
  results?: Array<{
    id: string;
    title: string;
    url?: string;
    duration?: number | string;
    author?: string;
    uploader?: string;
  }>;
  error?: string;
}

// ─── PlayerService event payloads ────────────────────────────────────────

export interface StateChangedEvent {
  guildId: GuildId;
  state: AudioPlayerState;
  track: Track | null;
}

export interface ButtonResult {
  success: boolean;
  error?: string;
}
