/**
 * Select Menu Interaction Handler
 * Processes string select menu interactions: queue track removal,
 * loop mode selection, and search result selection.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MessageFlags } from 'discord.js';
import EmbedBuilders = require('../../../ui/embeds');
import ButtonBuilders = require('../../../ui/buttons');
import SearchService = require('../../../search/search_service');
import SearchSessionStore = require('../../../search/search_session_store');
import PlaybackCoordinator = require('../../../playback/playback_coordinator');
import { playAttachment } from '../../../playback/playlist_coordinator';
import { resolveSpotifyPlayback } from '../../../spotify/playback_resolver';
import { createInteractionStageReporter } from '../../../playback/stage_feedback';
import {
  RADIO_ONLY_STOP_MESSAGE,
  isRadioBlockedSelect,
} from '../../../playback/radio_controls';
import * as logger from '../../../services/logger_service';
import * as Lock from '../../../utils/lock';

/**
 * Create a select menu interaction handler bound to the given player service.
 */
function createSelectMenuHandler(playerService: any) {
  return async function handleSelectMenuInteraction(interaction: any): Promise<void> {
    try {
      const customId = interaction.customId as string;

      if (isRadioBlockedSelect(customId) && isRadioMode(interaction, playerService)) {
        await interaction.reply({
          content: RADIO_ONLY_STOP_MESSAGE,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (customId === 'queue_remove_select') {
        return await handleQueueRemove(interaction, playerService);
      }

      if (customId === 'loop_select') {
        return await handleLoopSelect(interaction, playerService);
      }

      // Paginated search results (Components V2) — must be checked before
      // the legacy 'search_select_' prefix, which it also matches.
      if (customId.startsWith('search_select_v2_')) {
        return await handleSearchSelectV2(interaction, customId, playerService);
      }

      if (customId.startsWith('search_select_')) {
        return await handleSearchSelect(interaction, customId, playerService);
      }

      if (customId.startsWith('play_search_')) {
        return await handlePlaySearch(interaction, customId, playerService);
      }
    } catch (error: unknown) {
      await handleSelectMenuError(interaction, error as Error);
    }
  };
}

function isRadioMode(interaction: any, playerService: any): boolean {
  const guildId = interaction.guild?.id;
  if (!guildId || typeof playerService.getPlayer !== 'function') return false;

  try {
    return Boolean(playerService.getPlayer(guildId)?.radioMode);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Queue Remove
// ---------------------------------------------------------------------------

async function handleQueueRemove(interaction: any, playerService: any): Promise<void> {
  const customId = interaction.customId as string;
  const user     = interaction.user;

  if (Lock.shouldDebounce(interaction.guild.id, customId, 1000)) {
    await interaction.reply({ content: '操作过于频繁，请稍后重试', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!Lock.acquire(interaction.guild.id, customId)) {
    await interaction.reply({ content: '操作繁忙，请稍后重试', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const selectedValue = interaction.values[0] as string;

    logger.debug('Queue remove select menu interaction received', {
      selectedValue,
      user:  user.username,
      guild: interaction.guild?.name,
    });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let responseEmbed: any;
    let responseButtons: any;

    if (selectedValue === 'clear_all' || selectedValue === 'remove_all') {
      const cleared = playerService.clearQueue(interaction.guild.id);
      if (!cleared) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Clear Queue Failed', 'Failed to clear the queue',
          { suggestion: 'Please try again.' },
        );
        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      responseEmbed   = EmbedBuilders.createSuccessEmbed('Queue Cleared', '\u{1F5D1}️ All tracks have been removed from the queue');
      responseButtons = ButtonBuilders.createQueueControls({ hasQueue: false });
    } else {
      const indexMatch = selectedValue.match(/^remove_(\d+)$/);
      if (!indexMatch) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Invalid Selection', 'Invalid track selection format',
          { suggestion: 'Please try selecting a track again.' },
        );
        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      const index = parseInt(indexMatch[1]);
      const ok    = playerService.removeTrack(interaction.guild.id, index);

      if (!ok) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Remove Track Failed', 'Failed to remove the track',
          { suggestion: 'Please try again.' },
        );
        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      responseEmbed = EmbedBuilders.createSuccessEmbed('Track Removed', '\u{1F5D1}️ Track has been removed from the queue');

      const queueInfoAfter = playerService.getQueue(interaction.guild.id);
      responseButtons      = ButtonBuilders.createQueueControls({
        hasQueue: queueInfoAfter.queue.length > 0,
      });
    }

    // Best-effort: refresh the queue message UI.
    // Wrapped in its own try/catch so a Discord API hiccup cannot clobber the
    // success reply that the user should always see.
    try {
      const queueInfo  = playerService.getQueue(interaction.guild.id);
      const queueEmbed = EmbedBuilders.createQueueEmbed(queueInfo.queue, {
        currentTrack: queueInfo.currentTrack,
        page:         1,
        itemsPerPage: 10,
        totalPages:   Math.ceil((queueInfo.state?.queueLength ?? 0) / 10) || 1,
      });
      const response: Record<string, any> = { embeds: [queueEmbed] };
      if (responseButtons) {
        response.components = responseButtons;
      }
      await interaction.message.edit(response);
    } catch (_editErr: unknown) {
      logger.warn('Failed to refresh queue message after track removal', {
        guild: interaction.guild?.name,
      });
    }

    await interaction.editReply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });

    logger.info('Track removed via select menu', {
      selectedValue,
      user:  user.username,
      guild: interaction.guild?.name,
    });
  } finally {
    Lock.release(interaction.guild.id, customId);
  }
}

// ---------------------------------------------------------------------------
// Loop Select
// ---------------------------------------------------------------------------

async function handleLoopSelect(interaction: any, playerService: any): Promise<void> {
  const customId     = interaction.customId as string;
  const user         = interaction.user;
  const selectedMode = interaction.values[0] as string;

  if (Lock.shouldDebounce(interaction.guild.id, customId, 1000)) {
    await interaction.reply({ content: '操作过于频繁，请稍后重试', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!Lock.acquire(interaction.guild.id, customId)) {
    await interaction.reply({ content: '操作繁忙，请稍后重试', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    logger.debug('Loop select menu interaction received', {
      selectedMode,
      user:  user.username,
      guild: interaction.guild?.name,
    });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = playerService.setLoopMode(interaction.guild.id, selectedMode);

    if (!result.success) {
      const errorEmbed = EmbedBuilders.createErrorEmbed(
        'Loop Mode Failed',
        result.error || 'Failed to change loop mode',
        { suggestion: result.suggestion || 'Please try again.' },
      );
      return await interaction.editReply({ embeds: [errorEmbed] });
    }

    const loopEmoji  = selectedMode === 'none' ? '➡️' : selectedMode === 'queue' ? '\u{1F501}' : '\u{1F502}';
    const loopText   = selectedMode === 'none' ? 'disabled' : selectedMode === 'queue' ? 'enabled (queue)' : 'enabled (single)';
    const successEmbed = EmbedBuilders.createSuccessEmbed('Loop Mode Changed', `${loopEmoji} Loop mode ${loopText}`);

    await interaction.editReply({ embeds: [successEmbed] });
    playerService.notifyState(interaction.guild.id);

    logger.info('Loop mode changed via select menu', {
      mode:  selectedMode,
      user:  user.username,
      guild: interaction.guild?.name,
    });
  } finally {
    Lock.release(interaction.guild.id, customId);
  }
}

type DirectSelectionPlatform = 'bilibili' | 'youtube';

interface DirectVideoSelection {
  platform: DirectSelectionPlatform;
  url: string;
}

function isDirectSelectionValue(value: string): boolean {
  return value.startsWith('bili:') || value.startsWith('yt:');
}

function normalizeBilibiliSelection(rawIdentity: string): string | null {
  const identity = rawIdentity.trim();
  if (!identity) return null;

  if (/^https?:\/\//i.test(identity)) {
    const match = identity.match(/\/video\/(BV[a-zA-Z0-9]+|av\d+)/i);
    return match ? `https://www.bilibili.com/video/${match[1]}` : null;
  }

  if (/^BV[a-zA-Z0-9]+$/.test(identity)) {
    return `https://www.bilibili.com/video/${identity}`;
  }

  if (/^av\d+$/i.test(identity)) {
    return `https://www.bilibili.com/video/av${identity.replace(/^av/i, '')}`;
  }

  if (/^\d+$/.test(identity)) {
    return `https://www.bilibili.com/video/av${identity}`;
  }

  return null;
}

function normalizeYouTubeSelection(rawIdentity: string): string | null {
  const identity = rawIdentity.trim();
  if (!identity) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(identity)) {
    return `https://www.youtube.com/watch?v=${identity}`;
  }

  if (/^https?:\/\//i.test(identity)) {
    const watchMatch = identity.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) return `https://www.youtube.com/watch?v=${watchMatch[1]}`;

    const pathMatch = identity.match(/(?:youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([a-zA-Z0-9_-]{11})/);
    if (pathMatch) return `https://www.youtube.com/watch?v=${pathMatch[1]}`;
  }

  return null;
}

function parseDirectSelectionValue(value: string): DirectVideoSelection | null {
  if (value.startsWith('bili:')) {
    const url = normalizeBilibiliSelection(value.slice('bili:'.length));
    return url ? { platform: 'bilibili', url } : null;
  }

  if (value.startsWith('yt:')) {
    const url = normalizeYouTubeSelection(value.slice('yt:'.length));
    return url ? { platform: 'youtube', url } : null;
  }

  return null;
}

function getTitle(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const title = (value as { title?: unknown }).title;
  return typeof title === 'string' && title.trim() ? title : null;
}

async function editInvalidSelection(interaction: any): Promise<void> {
  const errorEmbed = EmbedBuilders.createErrorEmbed(
    'Invalid Selection', 'Invalid search result selection format',
    { suggestion: 'Please try selecting a result again.' },
  );
  await interaction.editReply({ embeds: [errorEmbed] });
}

async function playBilibiliSelection(
  interaction: any,
  playerService: any,
  videoUrl: string,
  titleHint?: string,
): Promise<boolean> {
  const stageReporter = createInteractionStageReporter(interaction, 'Bilibili');
  const addResult = await PlaybackCoordinator.playUrl('bilibili', {
    interaction,
    playerService,
    url: videoUrl,
    onStage: stageReporter,
  });
  await stageReporter.finish();

  if (!addResult || !addResult.success) {
    const errorEmbed = EmbedBuilders.createErrorEmbed(
      'Failed to Add Video',
      addResult?.error || 'Failed to add the selected video to queue.',
      { suggestion: addResult?.suggestion || 'Please try again.' },
    );
    await interaction.editReply({ content: '', embeds: [errorEmbed] });
    return false;
  }

  const title = getTitle(addResult.track) || titleHint || 'selected video';
  const successEmbed = EmbedBuilders.createSuccessEmbed(
    'Added to Queue',
    `[TV] **${title}** has been added to the queue`,
  );
  await interaction.editReply({ content: '', embeds: [successEmbed] });
  return true;
}

async function playYouTubeSelection(
  interaction: any,
  playerService: any,
  videoUrl: string,
  titleHint?: string,
): Promise<boolean> {
  const stageReporter = createInteractionStageReporter(interaction, 'YouTube');
  const addResult = await PlaybackCoordinator.playUrl('youtube', {
    interaction,
    playerService,
    url: videoUrl,
    onStage: stageReporter,
  });
  await stageReporter.finish();

  if (!addResult.success) {
    const errorEmbed = EmbedBuilders.createErrorEmbed(
      'Failed to Add Video',
      addResult.error || 'Failed to add the selected video to queue.',
      { suggestion: addResult.suggestion || 'Please try again.' },
    );
    await interaction.editReply({ embeds: [errorEmbed] });
    return false;
  }

  const title = getTitle(addResult.track) || getTitle(addResult.videoData) || titleHint || 'selected video';
  const successEmbed = EmbedBuilders.createSuccessEmbed(
    'Added to Queue',
    `>> **${title}** has been added to the queue`,
  );
  await interaction.editReply({ embeds: [successEmbed] });
  return true;
}

async function playDirectSelection(interaction: any, playerService: any, selection: DirectVideoSelection): Promise<boolean> {
  if (selection.platform === 'bilibili') {
    return playBilibiliSelection(interaction, playerService, selection.url);
  }

  return playYouTubeSelection(interaction, playerService, selection.url);
}

// ---------------------------------------------------------------------------
// Spotify selection (resolves via the resolveSpotifyPlayback seam)
// ---------------------------------------------------------------------------

/**
 * Plays an already-extracted Spotify direct track (`kind: 'direct'` from
 * `resolveSpotifyPlayback`) via the same pre-built-track path uploaded
 * attachments use (`playAttachment`) — the data is already a finished,
 * `cached: true` `ExtractedTrackData` pointing at a local file, so there's no
 * extraction step. `playAttachment` itself refuses while radio is enabled
 * (`RADIO_ACTIVE`); the resolver already avoids ever reaching this branch in
 * that case (see playback_resolver.ts's radio rule), but the guard stays as
 * defense-in-depth against a radio toggle racing the resolve.
 */
async function playDirectSpotifyEntry(interaction: any, playerService: any, data: any): Promise<boolean> {
  const result = await playAttachment({ interaction, playerService, data });

  if (!result.success) {
    const message = result.error === 'RADIO_ACTIVE'
      ? '电台模式运行中，无法直接播放该曲目。'
      : (result.error || '播放失败，请重试。');
    const errorEmbed = EmbedBuilders.createErrorEmbed('Failed to Add Track', message, { suggestion: 'Please try again.' });
    await interaction.editReply({ embeds: [errorEmbed] });
    return false;
  }

  const title = getTitle(result.track) || data.title || 'selected track';
  const successEmbed = EmbedBuilders.createSuccessEmbed(
    'Added to Queue',
    `>> **${title}** has been added to the queue（Spotify 直连）`,
  );
  await interaction.editReply({ content: '', embeds: [successEmbed] });
  return true;
}

/**
 * Resolves a Spotify session entry to a playable target — direct Spotify
 * audio when the sidecar is configured and radio isn't active, otherwise a
 * YouTube match (`resolveSpotifyPlayback`, Project B) — and plays it. The
 * entry's `uploader` field is the artists joined with ", " (see
 * `search_results_view.ts`'s `createSpotifySessionEntry`), so it's split back
 * apart for the resolver's `artists: string[]` input.
 */
async function resolveAndPlaySpotifyEntry(interaction: any, entry: any, playerService: any): Promise<boolean> {
  const youtubeExtractor = playerService.getYouTubeExtractor?.();
  const directExtractor = playerService.getSpotifyDirectExtractor?.();
  const radioActive = Boolean(playerService.getRadioService?.()?.isEnabled(interaction.guild.id));
  const meta = {
    id: entry.spotifyId || '',
    title: entry.title,
    artists: entry.uploader && entry.uploader !== 'Unknown' ? entry.uploader.split(', ') : [],
    durationSec: typeof entry.duration === 'number' ? entry.duration : Number(entry.duration) || 0,
  };

  const target = await resolveSpotifyPlayback(meta, { youtubeExtractor, directExtractor, radioActive });
  if (!target) {
    const errorEmbed = EmbedBuilders.createErrorEmbed(
      'Video Not Found', '找不到对应的 YouTube 视频。',
      { suggestion: 'Please try a different search.' },
    );
    await interaction.editReply({ embeds: [errorEmbed] });
    return false;
  }

  if (target.kind === 'direct') {
    return playDirectSpotifyEntry(interaction, playerService, target.data);
  }

  return playYouTubeSelection(interaction, playerService, target.url, target.title);
}

// ---------------------------------------------------------------------------
// Search Select (Components V2, paginated)
// ---------------------------------------------------------------------------

/**
 * search_select_v2_<token>: selection from the paginated search results view.
 * Option values are direct identities ("bili:<id>" / "yt:<id>") or an
 * "idx_<n>" fallback resolved against the stored session entry's URL.
 */
async function handleSearchSelectV2(interaction: any, customId: string, playerService: any): Promise<void> {
  const user          = interaction.user;
  const selectedValue = interaction.values[0] as string;

  logger.debug('Search result select menu (v2) interaction received', {
    selectedValue,
    user:  user.username,
    guild: interaction.guild?.name,
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const directSelection = parseDirectSelectionValue(selectedValue);
  if (directSelection) {
    const played = await playDirectSelection(interaction, playerService, directSelection);
    if (!played) return;
    logger.info('Video added to queue from paginated search results', {
      platform: directSelection.platform,
      user:     user.username,
      guild:    interaction.guild?.name,
    });
    return;
  }

  const expiredEmbed = () => EmbedBuilders.createErrorEmbed(
    'Search Expired', '搜索已过期，请重新搜索。',
    { suggestion: 'Please perform a new search.' },
  );

  if (selectedValue.startsWith('spot:')) {
    const spotifyId = selectedValue.slice('spot:'.length);
    const token = customId.slice('search_select_v2_'.length);
    const session = SearchSessionStore.get(token);
    const entry = session?.entries.find((e: any) => e.platform === 'spotify' && e.spotifyId === spotifyId);
    if (!entry) {
      return await interaction.editReply({ embeds: [expiredEmbed()] });
    }

    const played = await resolveAndPlaySpotifyEntry(interaction, entry, playerService);
    if (!played) return;
    logger.info('Video added to queue from paginated search results (Spotify)', {
      user:  user.username,
      guild: interaction.guild?.name,
    });
    return;
  }

  const indexMatch = selectedValue.match(/^idx_(\d+)$/);
  if (!indexMatch) {
    return await editInvalidSelection(interaction);
  }

  const token = customId.slice('search_select_v2_'.length);
  const session = SearchSessionStore.get(token);
  const entry = session?.entries[parseInt(indexMatch[1], 10)];
  if (!entry) {
    return await interaction.editReply({ embeds: [expiredEmbed()] });
  }

  if (entry.platform === 'spotify') {
    const played = await resolveAndPlaySpotifyEntry(interaction, entry, playerService);
    if (!played) return;
    logger.info('Video added to queue from paginated search results (Spotify, index fallback)', {
      user:  user.username,
      guild: interaction.guild?.name,
    });
    return;
  }

  if (!entry.url) {
    return await interaction.editReply({ embeds: [expiredEmbed()] });
  }

  const played = entry.platform === 'youtube'
    ? await playYouTubeSelection(interaction, playerService, entry.url, entry.title)
    : await playBilibiliSelection(interaction, playerService, entry.url, entry.title);
  if (!played) return;

  logger.info('Video added to queue from paginated search results (index fallback)', {
    platform:   entry.platform,
    videoTitle: entry.title,
    user:       user.username,
    guild:      interaction.guild?.name,
  });
}

// ---------------------------------------------------------------------------
// Search Select
// ---------------------------------------------------------------------------

async function handleSearchSelect(interaction: any, customId: string, playerService: any): Promise<void> {
  const user          = interaction.user;
  const selectedValue = interaction.values[0] as string;

  logger.debug('Search result select menu interaction received', {
    selectedValue,
    user:  user.username,
    guild: interaction.guild?.name,
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const keyword     = customId.replace('search_select_', '').replace(/_/g, ' ');

  try {
    const directSelection = parseDirectSelectionValue(selectedValue);
    if (directSelection) {
      const played = await playDirectSelection(interaction, playerService, directSelection);
      if (!played) return;
      logger.info('Video added to queue from direct search result', {
        platform: directSelection.platform,
        user:     user.username,
        guild:    interaction.guild?.name,
      });
      return;
    }

    if (isDirectSelectionValue(selectedValue)) {
      return await editInvalidSelection(interaction);
    }

    const originalEmbed = interaction.message.embeds[0];
    if (!originalEmbed || !originalEmbed.description) {
      const errorEmbed = EmbedBuilders.createErrorEmbed(
        'Search Results Not Found', 'Could not find the original search results.',
        { suggestion: 'Please perform a new search.' },
      );
      return await interaction.editReply({ embeds: [errorEmbed] });
    }

    const indexMatch = selectedValue.match(/^search_result_(\d+)$/);
    if (!indexMatch) {
      return await editInvalidSelection(interaction);
    }

    const resultIndex = parseInt(indexMatch[1], 10);
    const extractor = playerService.getExtractor();
    if (!extractor) {
      const errorEmbed = EmbedBuilders.createErrorEmbed(
        'Extractor Not Available', 'Bilibili extractor is not available.',
        { suggestion: 'Please try again later.' },
      );
      return await interaction.editReply({ embeds: [errorEmbed] });
    }

    const searchResults = await SearchService.searchBilibili({
      keyword,
      limit: 25,
      extractor,
    });

    if (resultIndex >= searchResults.length) {
      const errorEmbed = EmbedBuilders.createErrorEmbed(
        'Video Not Found', 'The selected video is no longer available.',
        { suggestion: 'Please perform a new search.' },
      );
      return await interaction.editReply({ embeds: [errorEmbed] });
    }

    const selectedVideo = searchResults[resultIndex];
    const videoUrl      = selectedVideo.url || `https://www.bilibili.com/video/av${selectedVideo.id}`;

    const played = await playBilibiliSelection(interaction, playerService, videoUrl, selectedVideo.title);
    if (!played) return;

    logger.info('Video added to queue from search results', {
      videoTitle: selectedVideo.title,
      videoId:    selectedVideo.id,
      user:       user.username,
      guild:      interaction.guild?.name,
    });
  } catch (innerError: unknown) {
    logger.error('Failed to add video from search results', {
      error: (innerError as Error).message,
      stack: (innerError as Error).stack,
      user:  user.username,
      guild: interaction.guild?.name,
    });

    const errorEmbed = EmbedBuilders.createErrorEmbed(
      'Error Adding Video', 'An error occurred while adding the video to queue.',
      { suggestion: 'Please try again.' },
    );
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

// ---------------------------------------------------------------------------
// Play Search (dual-platform: Bilibili + YouTube from /play keyword)
// ---------------------------------------------------------------------------

async function handlePlaySearch(interaction: any, customId: string, playerService: any): Promise<void> {
  const user          = interaction.user;
  const selectedValue = interaction.values[0] as string; // "bili_0", "yt_2", etc.
  const member        = interaction.member;

  logger.debug('Play search select menu interaction received', {
    selectedValue,
    user:  user.username,
    guild: interaction.guild?.name,
  });

  if (!member?.voice?.channel) {
    await interaction.reply({ content: 'Voice channel required', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const keyword     = customId.replace('play_search_', '').replace(/_/g, ' ');
  const isBilibili  = selectedValue.startsWith('bili:') || selectedValue.startsWith('bili_');
  const resultIndex = parseInt(selectedValue.replace(/^(bili|yt)_/, ''), 10);

  try {
    const directSelection = parseDirectSelectionValue(selectedValue);
    if (directSelection) {
      const played = await playDirectSelection(interaction, playerService, directSelection);
      if (!played) return;
      logger.info('Video added to queue from direct play search', {
        platform: directSelection.platform,
        user:     user.username,
        guild:    interaction.guild?.name,
      });
      return;
    }

    if (isDirectSelectionValue(selectedValue) || Number.isNaN(resultIndex)) {
      return await editInvalidSelection(interaction);
    }

    if (isBilibili) {
      // ── Bilibili path (use HTTP API, not yt-dlp extractor) ──────────────
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const bilibiliApi = require('../../../bilibili/api') as any;
      const results = await SearchService.searchBilibili({
        keyword,
        limit: 10,
        bilibiliApi,
        source: 'api',
      });

      if (!results || resultIndex >= results.length) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Video Not Found', 'The selected video is no longer available.',
          { suggestion: 'Please search again.' },
        );
        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      const selectedVideo = results[resultIndex];
      const videoUrl = selectedVideo.url || `https://www.bilibili.com/video/${selectedVideo.bvid || 'av' + selectedVideo.id}`;
      const played = await playBilibiliSelection(interaction, playerService, videoUrl, selectedVideo.title);
      if (!played) return;
    } else {
      // ── YouTube path ────────────────────────────────────────────────────
      const ytExtractor = playerService.getYouTubeExtractor();
      if (!ytExtractor) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'YouTube Not Available', 'YouTube extractor is not available.',
          { suggestion: 'Please try again later.' },
        );
        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      const results = await SearchService.searchYouTube({
        keyword,
        limit: 10,
        youtubeExtractor: ytExtractor,
      });

      if (resultIndex >= results.length) {
        const errorEmbed = EmbedBuilders.createErrorEmbed(
          'Video Not Found', 'The selected video is no longer available.',
          { suggestion: 'Please search again.' },
        );
        return await interaction.editReply({ embeds: [errorEmbed] });
      }

      const selectedVideo = results[resultIndex];
      const videoUrl = selectedVideo.url || `https://www.youtube.com/watch?v=${selectedVideo.id}`;
      const played = await playYouTubeSelection(interaction, playerService, videoUrl, selectedVideo.title);
      if (!played) return;
    }

    logger.info('Video added to queue from play search', {
      platform: isBilibili ? 'bilibili' : 'youtube',
      index:    resultIndex,
      user:     user.username,
      guild:    interaction.guild?.name,
    });
  } catch (innerError: unknown) {
    logger.error('Failed to add video from play search', {
      error:    (innerError as Error).message,
      platform: isBilibili ? 'bilibili' : 'youtube',
      user:     user.username,
      guild:    interaction.guild?.name,
    });

    const msg = (innerError as Error).message || '';
    const lowerMsg = msg.toLowerCase();
    let content = 'An error occurred while adding the video.';
    if (lowerMsg.includes('auth/bot check') || lowerMsg.includes('automatic cookie refresh') || lowerMsg.includes('cookies expired')) {
      content = '[✗] YouTube auth check failed after automatic cookie refresh. The bot account may need a fresh VPS browser login.';
    }

    const errorEmbed = EmbedBuilders.createErrorEmbed('Error Adding Video', content, { suggestion: 'Please try again.' });
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

async function handleSelectMenuError(interaction: any, error: Error): Promise<void> {
  logger.error('Select menu interaction failed', {
    customId: interaction.customId,
    user:     interaction.user.username,
    guild:    interaction.guild?.name,
    error:    error.message,
    stack:    error.stack,
  });

  try {
    const errorEmbed = EmbedBuilders.createErrorEmbed(
      'Interaction Failed', 'An error occurred while processing your selection.',
      { errorCode: 'SELECT_MENU_FAILED' },
    );

    if (interaction.deferred) {
      await interaction.editReply({ embeds: [errorEmbed] });
    } else if (!interaction.replied) {
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
  } catch (replyError: unknown) {
    logger.error('Failed to send error response for select menu', {
      error: (replyError as Error).message,
    });
  }
}

export = createSelectMenuHandler;
