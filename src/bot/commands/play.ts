/**
 * Play Command
 * Plays audio from a Bilibili or YouTube video URL, or keyword search.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { routeQuery, type RouteResult } from '../../utils/url_router';
import SearchResultsView = require('../../ui/search_results_view');
import SearchService = require('../../search/search_service');
import SearchSessionStore = require('../../search/search_session_store');
import BilibiliUrls = require('../../search/bilibili_urls');
import YouTubeUrls = require('../../search/youtube_urls');
import PlaybackCoordinator = require('../../playback/playback_coordinator');
import { createInteractionStageReporter, createThrottledProgressReporter } from '../../playback/stage_feedback';
import { playPlaylist, playAttachment } from '../../playback/playlist_coordinator';
import { validateAttachment, buildAttachmentTrackData, type AttachmentInput } from '../../playback/attachment_track';
import * as logger from '../../services/logger_service';
import config = require('../../config/config');
import SpotifyClient = require('../../spotify/client');
import { resolveSpotifyPlayback } from '../../spotify/playback_resolver';
import { interleaveRoundRobin } from '../../search/interleave';
import BilibiliApi = require('../../bilibili/api');
import BilibiliValidator = require('../../bilibili/validator');
import { resolvePlaylist } from '../../playlists';
import { resolveBilibiliMultipart } from '../../playlists/bilibili_playlist_resolver';
import type { ResolvedPlaylist, PlaylistProgress } from '../../playlists/types';

// Lazily constructed on first Spotify link — mirrors the
// `require('../../bilibili/api')` singleton-on-demand precedent below.
// No composition-root wiring needed since the client is stateless besides
// its own token cache.
let spotifyClient: SpotifyClient | null = null;
function getSpotifyClient(): SpotifyClient {
  if (!spotifyClient) {
    spotifyClient = new SpotifyClient({
      clientId: config.spotify.clientId || '',
      clientSecret: config.spotify.clientSecret || '',
      market: config.spotify.market,
    });
  }
  return spotifyClient;
}

/** Rejects with `timeoutError` if `promise` doesn't settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutError)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error as Error); },
    );
  });
}

/**
 * Shared resolve → bulk-enqueue → report flow for every playlist source
 * (YouTube playlist, Bilibili fav/collection/multipart, Spotify album/
 * playlist). `resolve` does the source-specific fetch (and may itself throw,
 * e.g. BILIBILI_FAV_PRIVATE) while everything after that — progress
 * throttling, queueing via playPlaylist, and the final reply — is identical
 * across sources.
 */
async function runPlaylistFlow(
  interaction: ChatInputCommandInteraction<'cached'>,
  playbackService: any,
  resolve: (onProgress: PlaylistProgress) => Promise<ResolvedPlaylist>,
): Promise<void> {
  const progress = createThrottledProgressReporter(interaction, config.playlists.progressIntervalMs);

  try {
    const playlist = await resolve((fetched, total) => {
      progress.report(`正在解析歌单… 已获取 ${fetched}${total ? '/' + total : ''}`);
    });

    const result = await playPlaylist({
      interaction,
      playerService: playbackService,
      playlist,
      onProgress: (queued, total) => {
        progress.report(`已加入队列 ${queued}/${total}…`);
      },
    });

    await progress.finish();

    if (result.success) {
      let content = `>> 歌单「${result.title}」已加入 ${result.queued} 首`;
      if (result.truncated) {
        content += `（共 ${result.totalCount} 首，已截断至 ${config.playlists.maxItems}）`;
      }
      await interaction.editReply({ content });
      return;
    }

    if (result.error === 'RADIO_ACTIVE') {
      await interaction.editReply({ content: '[!] 电台模式运行中，歌单会被电台覆盖。请先使用 /radio 关闭电台再导入歌单。' });
    } else {
      await interaction.editReply({ content: `[!] 歌单解析失败: ${(result.error || '').substring(0, 100)}` });
    }
  } catch (err: unknown) {
    await progress.finish();
    const msg = (err as Error).message || '';
    if (msg === 'BILIBILI_FAV_PRIVATE') {
      await interaction.editReply({ content: '[!] 收藏夹不是公开的或不存在' });
    } else {
      await interaction.editReply({ content: `[!] 歌单解析失败: ${msg.substring(0, 100)}` });
    }
  }
}

/**
 * Shared validate → build → play → reply flow for both the `file` slash-
 * command option and a pasted Discord CDN link (route.kind === 'attachment').
 * No extraction step — the attachment IS the audio URL — so this only
 * validates type/size, builds the finished track, and hands it to
 * playAttachment.
 */
async function runAttachmentFlow(
  interaction: ChatInputCommandInteraction<'cached'>,
  playbackService: any,
  input: AttachmentInput,
): Promise<void> {
  const validation = validateAttachment(input, config.attachments.maxBytes);
  if (!validation.ok) {
    if (validation.reason === 'size') {
      const maxMb = Math.floor(config.attachments.maxBytes / 1024 / 1024);
      await interaction.editReply({ content: `[!] 文件过大（上限 ${maxMb}MB）` });
    } else {
      await interaction.editReply({ content: '[!] 不支持的文件类型（支持 mp3/m4a/ogg/wav/flac/webm）' });
    }
    return;
  }

  const trackData = buildAttachmentTrackData(input);
  const stageReporter = createInteractionStageReporter(interaction, 'Attachment');
  const result = await playAttachment({
    interaction,
    playerService: playbackService,
    data: trackData,
    onStage: stageReporter,
  });
  await stageReporter.finish();

  if (!result.success) {
    if (result.error === 'RADIO_ACTIVE') {
      await interaction.editReply({ content: '[!] 电台模式运行中，无法添加上传的文件。请先使用 /radio 关闭电台。' });
    } else {
      await interaction.editReply({ content: result.error || '[!] 添加失败' });
    }
    return;
  }

  const trackTitle = (result.track as { title?: string } | undefined)?.title;
  await interaction.editReply({ content: `>> 已添加: ${trackTitle || trackData.title}` });
  logger.info('Play command completed (attachment)', {
    title: trackTitle || trackData.title,
    user: interaction.user.username,
  });
}

/** Whether route.kind represents a bulk playlist source (Task 2.9). */
function isPlaylistRoute(route: RouteResult): boolean {
  if (route.kind === 'youtube-playlist' || route.kind === 'bilibili-fav' || route.kind === 'bilibili-collection') {
    return true;
  }
  return route.kind === 'spotify' && Boolean(route.spotify) && route.spotify!.type !== 'track';
}

const createPlayCommand = (playbackService: any, _queueService: any) => ({
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('播放 Bilibili / YouTube 视频（链接或关键词搜索）')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('视频链接或搜索关键词（支持 Bilibili / YouTube）')
        .setRequired(false),
    )
    .addAttachmentOption((option) =>
      option
        .setName('file')
        .setDescription('音频文件 (mp3/m4a/ogg/wav/flac/webm)')
        .setRequired(false),
    ),

  cooldown: 5,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const query  = interaction.options.getString('query') || interaction.options.getString('url');
      // Guarded with `?.` — several lightweight per-file test mocks of
      // `interaction.options` only implement getString/getInteger; real
      // discord.js interactions always have getAttachment.
      const attachment = interaction.options.getAttachment?.('file') ?? null;
      const user   = interaction.user;
      const member = interaction.member;

      if (!member.voice.channel) {
        await interaction.reply({ content: 'Voice channel required', flags: MessageFlags.Ephemeral });
        return;
      }

      const botVoiceChannel = interaction.guild.members.me?.voice?.channel;
      if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
        await interaction.reply({
          content: `Bot is already playing in <#${botVoiceChannel.id}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!query && !attachment) {
        await interaction.reply({
          content: '请提供链接/关键词，或附加一个音频文件',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // ─── Uploaded audio file (attachment wins when both query and file
      // are given) ────────────────────────────────────────────────────────
      if (attachment) {
        await runAttachmentFlow(interaction, playbackService, {
          url: attachment.url,
          name: attachment.name,
          contentType: attachment.contentType,
          size: attachment.size,
        });
        return;
      }

      const route = routeQuery(query as string);

      // ─── Pasted Discord CDN attachment link ────────────────────────────────
      if (route.kind === 'attachment') {
        await runAttachmentFlow(interaction, playbackService, { url: route.raw });
        return;
      }

      // ─── YouTube URL ────────────────────────────────────────────────────────
      // kind check (not just platform) — 'youtube-playlist' also has
      // platform:'youtube', isUrl:true and must fall through to the
      // playlist branch further down instead of being extracted as a
      // single (invalid) video.
      if (route.kind === 'youtube-video') {
        const ytExtractor = playbackService.getYouTubeExtractor();
        if (!ytExtractor) {
          await interaction.editReply({ content: '[!] YouTube support is not available' });
          return;
        }

        const stageReporter = createInteractionStageReporter(interaction, 'YouTube');
        const result = await PlaybackCoordinator.playUrl('youtube', {
          interaction,
          playerService: playbackService,
          url:           route.normalizedUrl || route.raw,
          onStage:       stageReporter,
        });
        await stageReporter.finish();
        if (!result.success) {
          const msg = result.error || '';
          const lowerMsg = msg.toLowerCase();
          if (lowerMsg.includes('auth/bot check') || lowerMsg.includes('automatic cookie refresh') || lowerMsg.includes('cookies expired')) {
            await interaction.editReply({
              content: '[✗] YouTube auth check failed after automatic cookie refresh. The bot account may need a fresh VPS browser login.',
            });
          } else if (msg.includes('unavailable') || msg.includes('private')) {
            await interaction.editReply({ content: '[!] Video is unavailable or private' });
          } else if (msg.includes('Age-restricted')) {
            await interaction.editReply({ content: '[!] Age-restricted video (login required)' });
          } else {
            await interaction.editReply({ content: `[!] YouTube extraction failed: ${msg.substring(0, 100)}` });
          }
          logger.error('YouTube extraction failed in play command', {
            url: route.normalizedUrl,
            error: msg,
            user: user.username,
          });
          return;
        }

        const trackTitle = (result.track as { title?: string } | undefined)?.title;
        await interaction.editReply({ content: `>> Added: ${trackTitle || route.raw}` });
        logger.info('Play command completed (YouTube)', {
          query,
          url: route.normalizedUrl,
          title: trackTitle,
          user: user.username,
        });
        return;
      }

      // ─── Bilibili URL ───────────────────────────────────────────────────────
      // kind check (not just platform) — 'bilibili-fav'/'bilibili-collection'
      // also have platform:'bilibili', isUrl:true and must fall through to
      // the playlist branch further down.
      if (route.kind === 'bilibili-video') {
        const url = route.normalizedUrl || route.raw;

        // 分P (multipart) detection: a bare BV URL (no explicit ?p=) whose
        // video actually has more than one part enqueues every part instead
        // of just page 1. Skipped while radio is enabled — the existing
        // single-URL playUrl() path already interjects page 1 into the
        // rotation, and a bulk enqueue would be silently discarded on the
        // next radio advance anyway (RadioService resets the queue).
        // Every failure mode here (bad id parse, API error, timeout) falls
        // through to the normal single-video path unchanged — detection is
        // strictly best-effort and must never block ordinary playback.
        try {
          const videoId = BilibiliValidator.extractVideoId(route.raw);
          const hasExplicitPage = /[?&]p=\d+/.test(route.raw);
          const radioEnabled = Boolean(playbackService.getRadioService?.()?.isEnabled(interaction.guild.id));

          if (videoId?.type === 'BV' && !hasExplicitPage && !radioEnabled) {
            const detected = await withTimeout(
              BilibiliApi.getVideoPages(videoId.id),
              config.playlists.multipartDetectTimeoutMs,
              'multipart detection timeout',
            );
            if (detected.pages.length > 1) {
              await runPlaylistFlow(interaction, playbackService, async (onProgress) => {
                onProgress(detected.pages.length, detected.pages.length);
                return resolveBilibiliMultipart({
                  bvid: videoId.id,
                  api: BilibiliApi,
                  maxItems: config.playlists.maxItems,
                });
              });
              return;
            }
          }
        } catch (detectError: unknown) {
          logger.debug('Bilibili multipart detection skipped', {
            url,
            error: (detectError as Error).message,
          });
        }

        const stageReporter = createInteractionStageReporter(interaction, 'Bilibili');
        const result = await PlaybackCoordinator.playUrl('bilibili', {
          interaction,
          playerService: playbackService,
          url,
          onStage: stageReporter,
        });
        await stageReporter.finish();
        if (!result.success) {
          await interaction.editReply({ content: result.error || 'Add failed' });
          return;
        }

        const trackTitle = (result.track as { title?: string } | undefined)?.title;
        await interaction.editReply({ content: `>> 已添加: ${trackTitle || url}` });
        logger.info('Play command completed (Bilibili)', {
          query,
          url,
          title: trackTitle,
          user: user.username,
        });
        return;
      }

      // ─── Spotify track link ─────────────────────────────────────────────────
      // Album/playlist Spotify routes (route.spotify.type !== 'track') fall
      // through to the playlist branch below instead (Task 2.9).
      if (route.kind === 'spotify' && route.spotify && route.spotify.type === 'track') {
        if (!config.spotify.enabled) {
          await interaction.editReply({ content: '[!] Spotify 支持未配置（缺少 SPOTIFY_CLIENT_ID/SECRET）' });
          return;
        }

        const ytExtractorForSpotify = playbackService.getYouTubeExtractor();
        if (!ytExtractorForSpotify) {
          await interaction.editReply({ content: '[!] YouTube support is not available' });
          return;
        }

        await interaction.editReply({ content: '正在解析 Spotify 曲目...' });

        const spotify = getSpotifyClient();
        let trackMeta: Awaited<ReturnType<typeof spotify.getTrack>>;
        try {
          trackMeta = await spotify.getTrack(route.spotify.id);
        } catch (err: unknown) {
          const msg = (err as Error).message;
          if (msg === 'SPOTIFY_NOT_FOUND') {
            await interaction.editReply({ content: '[!] 曲目不存在或不公开' });
          } else if (msg === 'SPOTIFY_AUTH_FAILED') {
            await interaction.editReply({ content: '[!] Spotify 凭据无效' });
          } else {
            await interaction.editReply({ content: `[!] Spotify 曲目解析失败: ${msg.substring(0, 100)}` });
          }
          logger.error('Spotify track lookup failed in play command', {
            spotifyId: route.spotify.id,
            error: msg,
            user: user.username,
          });
          return;
        }

        // Project B seam: direct Spotify extraction first (when the sidecar
        // is configured and radio isn't active), YouTube-match on any
        // failure — see spotify/playback_resolver.ts.
        const radioActiveForSpotify = Boolean(playbackService.getRadioService?.()?.isEnabled(interaction.guild.id));
        const spotifyTarget = await resolveSpotifyPlayback(
          { id: route.spotify.id, title: trackMeta.title, artists: trackMeta.artists, durationSec: trackMeta.durationSec },
          {
            youtubeExtractor: ytExtractorForSpotify,
            directExtractor: playbackService.getSpotifyDirectExtractor?.(),
            radioActive: radioActiveForSpotify,
          },
        );

        if (!spotifyTarget) {
          const artist = trackMeta.artists[0] ?? '';
          await interaction.editReply({
            content: `[!] 找不到对应的 YouTube 视频: ${artist} - ${trackMeta.title}`,
          });
          return;
        }

        if (spotifyTarget.kind === 'direct') {
          const directStageReporter = createInteractionStageReporter(interaction, 'Spotify');
          const directResult = await playAttachment({
            interaction,
            playerService: playbackService,
            data: spotifyTarget.data,
            onStage: directStageReporter,
          });
          await directStageReporter.finish();

          if (!directResult.success) {
            if (directResult.error === 'RADIO_ACTIVE') {
              await interaction.editReply({ content: '[!] 电台模式运行中，无法直接播放该曲目。请先使用 /radio 关闭电台。' });
            } else {
              await interaction.editReply({ content: `[!] 播放失败: ${(directResult.error || '').substring(0, 100)}` });
            }
            return;
          }

          await interaction.editReply({ content: `>> 已添加: ${trackMeta.title}（Spotify 直连）` });
          logger.info('Play command completed (Spotify direct)', {
            query,
            spotifyId: route.spotify.id,
            title: trackMeta.title,
            user: user.username,
          });
          return;
        }

        const spotifyStageReporter = createInteractionStageReporter(interaction, 'YouTube');
        const spotifyResult = await PlaybackCoordinator.playUrl('youtube', {
          interaction,
          playerService: playbackService,
          url: spotifyTarget.url,
          onStage: spotifyStageReporter,
        });
        await spotifyStageReporter.finish();
        if (!spotifyResult.success) {
          const msg = spotifyResult.error || '';
          const lowerMsg = msg.toLowerCase();
          if (lowerMsg.includes('auth/bot check') || lowerMsg.includes('automatic cookie refresh') || lowerMsg.includes('cookies expired')) {
            await interaction.editReply({
              content: '[✗] YouTube auth check failed after automatic cookie refresh. The bot account may need a fresh VPS browser login.',
            });
          } else if (msg.includes('unavailable') || msg.includes('private')) {
            await interaction.editReply({ content: '[!] Video is unavailable or private' });
          } else if (msg.includes('Age-restricted')) {
            await interaction.editReply({ content: '[!] Age-restricted video (login required)' });
          } else {
            await interaction.editReply({ content: `[!] YouTube extraction failed: ${msg.substring(0, 100)}` });
          }
          logger.error('YouTube extraction failed in play command (Spotify)', {
            url: spotifyTarget.url,
            error: msg,
            user: user.username,
          });
          return;
        }

        await interaction.editReply({ content: `>> 已添加: ${trackMeta.title}（Spotify → YouTube）` });
        logger.info('Play command completed (Spotify → YouTube)', {
          query,
          spotifyId: route.spotify.id,
          url: spotifyTarget.url,
          title: trackMeta.title,
          user: user.username,
        });
        return;
      }

      // ─── Playlist ingestion (YouTube playlist / Bilibili fav / Bilibili
      // collection / Spotify album & playlist) ────────────────────────────────
      // Replaces the Task 1.3 Spotify album/playlist stub.
      if (isPlaylistRoute(route)) {
        if (route.kind === 'youtube-playlist' && !playbackService.getYouTubeExtractor()) {
          await interaction.editReply({ content: '[!] YouTube support is not available' });
          return;
        }
        if (route.kind === 'spotify' && !config.spotify.enabled) {
          await interaction.editReply({ content: '[!] Spotify 支持未配置（缺少 SPOTIFY_CLIENT_ID/SECRET）' });
          return;
        }

        await runPlaylistFlow(interaction, playbackService, (onProgress) => resolvePlaylist(route, {
          youtubeExtractor: playbackService.getYouTubeExtractor(),
          bilibiliApi: BilibiliApi,
          spotifyClient: config.spotify.enabled ? getSpotifyClient() : null,
          maxItems: config.playlists.maxItems,
          onProgress,
        }));
        logger.info('Play command completed (playlist)', {
          query,
          kind: route.kind,
          user: user.username,
        });
        return;
      }

      // ─── Unsupported URL ────────────────────────────────────────────────────
      if (route.isUrl && route.platform === 'unknown') {
        await interaction.editReply({
          content: '[!] 不支持的链接格式。目前支持 Bilibili 和 YouTube 链接。',
        });
        return;
      }

      // ─── Keyword search (Bilibili + YouTube + Spotify) ───────────────────────
      const searchPlatformsLabel = config.spotify.enabled ? 'Bilibili、YouTube 和 Spotify' : 'Bilibili & YouTube';
      await interaction.editReply({ content: `[?] Searching "${query}" on ${searchPlatformsLabel}...` });

      const ytExtractorForSearch = playbackService.getYouTubeExtractor();
      const perPlatformLimit = config.search.limitPerPlatform;

      // Bilibili uses the HTTP API here so initial discovery stays fast.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const bilibiliApi = require('../../bilibili/api') as any;

      const searchResult = await SearchService.searchTriPlatforms({
        keyword:          query as string,
        limitPerPlatform: perPlatformLimit,
        bilibiliApi,
        youtubeExtractor: ytExtractorForSearch,
        spotifyClient:    config.spotify.enabled ? getSpotifyClient() : null,
      });
      const biliResults    = searchResult.bilibili;
      const ytResults      = searchResult.youtube;
      const spotifyResults = searchResult.spotify;

      if (biliResults.length === 0 && ytResults.length === 0 && spotifyResults.length === 0) {
        await interaction.editReply({ content: `No results found for "${query}"` });
        return;
      }

      // Per-platform entries, round-robin interleaved into one numbered list
      // (bili1, yt1, spotify1, bili2, ...) and paginated by the shared search
      // results view. Cap at 30 total; the per-page select menu removes any
      // need for a 25-entry cap (Discord's select-option limit).
      const biliEntries    = SearchResultsView.createSessionEntries(biliResults as any[], 'bilibili');
      const ytEntries      = SearchResultsView.createSessionEntries(ytResults as any[], 'youtube', biliEntries.length);
      const spotifyEntries = SearchResultsView.createSessionEntries(
        spotifyResults as any[], 'spotify', biliEntries.length + ytEntries.length,
      );
      const interleavedEntries = interleaveRoundRobin([biliEntries, ytEntries, spotifyEntries]).slice(0, 30);

      const session = {
        keyword: query as string,
        mode: 'mixed' as const,
        entries: interleavedEntries,
      };
      const token = SearchSessionStore.create(session);

      // Clear the "Searching..." text so only the results embed remains.
      await interaction.editReply({
        content: null,
        ...SearchResultsView.buildSearchResultsMessage(token, { ...session, currentPage: 1 }),
      });

      // Only prewarm the first page's worth per platform; the rest may never
      // be viewed. Spotify entries have no direct URL, so they can't be
      // prewarmed.
      playbackService.prewarmBilibiliUrls?.(
        BilibiliUrls.collectBilibiliUrls(biliResults, SearchResultsView.RESULTS_PER_PAGE),
        {
          source: 'play_search',
          guildId: interaction.guild.id,
          keyword: query as string,
        },
      );
      playbackService.prewarmYouTubeUrls?.(
        YouTubeUrls.collectYouTubeUrls(ytResults, SearchResultsView.RESULTS_PER_PAGE),
        {
          source: 'play_search',
          guildId: interaction.guild.id,
          keyword: query as string,
        },
      );

      logger.info('Play keyword search: showing interleaved tri-platform results', {
        query,
        biliCount:    biliResults.length,
        ytCount:      ytResults.length,
        spotifyCount: spotifyResults.length,
        rawBiliCount: searchResult.rawBilibiliCount,
        rawYtCount:   searchResult.rawYouTubeCount,
        user: user.username,
      });
    } catch (e: unknown) {
      logger.error('Play command failed', {
        query: interaction.options.getString('query'),
        user: interaction.user.username,
        error: (e as Error).message,
        stack: (e as Error).stack,
      });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Play failed' });
        } else {
          await interaction.reply({ content: 'Play failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createPlayCommand;
