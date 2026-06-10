/**
 * Search Results View
 * Renders paginated search results as a compact two-column embed. Dual
 * searches put Bilibili in the left column and YouTube in the right;
 * single-platform searches split the page across both columns. A select
 * menu over all results and page buttons sit below the embed.
 * Shared by /search, /play keyword search, and the page-button handler.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import Formatters = require('../utils/formatters');
import SelectionValues = require('../search/selection_values');

// Each page shows two columns of this many results (10 per page).
const RESULTS_PER_PAGE = 5;
const SEARCH_ACCENT_COLOR = 0x00ae86;
const COLUMN_TITLE_LENGTH = 35;

type SearchSessionPlatform = 'bilibili' | 'youtube';

interface RawSearchResult {
  title: string;
  uploader?: string;
  author?: string;
  duration?: string | number;
  viewCount?: number;
  view?: number;
  id?: string | number;
  bvid?: string;
  aid?: string | number;
  url?: string;
  [key: string]: unknown;
}

interface SearchSessionEntry {
  platform: SearchSessionPlatform;
  title: string;
  uploader: string;
  duration?: string | number;
  viewCount?: number;
  url: string | null;
  selectionValue: string;
}

interface SearchSessionLike {
  keyword: string;
  mode: SearchSessionPlatform | 'dual';
  entries: SearchSessionEntry[];
  currentPage: number;
}

/**
 * Convert raw search results into session entries with precomputed
 * selection values. `startIndex` keeps the index fallback values unique
 * when entries from two platforms are concatenated into one session.
 */
function createSessionEntries(
  results: RawSearchResult[],
  platform: SearchSessionPlatform,
  startIndex = 0,
): SearchSessionEntry[] {
  return results.map((result, i) => {
    const viewCount = Number(result.viewCount ?? result.view);
    return {
      platform,
      title: result.title || 'Unknown',
      uploader: result.uploader || result.author || 'Unknown',
      duration: result.duration,
      viewCount: Number.isFinite(viewCount) && viewCount > 0 ? viewCount : undefined,
      url: typeof result.url === 'string' && result.url ? result.url : null,
      selectionValue: SelectionValues.createSelectionValue(platform, result, `idx_${startIndex + i}`),
    };
  });
}

// Zero-width space — embed field names/values must be non-empty.
const BLANK = '​';

interface EmbedFieldData {
  name: string;
  value: string;
  inline: boolean;
}

/** "B3" / "Y1" labels in dual mode, plain "3" in single-platform mode. */
function entryLabel(entry: SearchSessionEntry, indexInPlatform: number, dual: boolean): string {
  if (!dual) return String(indexInPlatform + 1);
  return `${entry.platform === 'youtube' ? 'Y' : 'B'}${indexInPlatform + 1}`;
}

// Field names render bold without markdown parsing, so the title needs
// no escaping; the value line carries duration + uploader.
function entryField(entry: SearchSessionEntry, label: string): EmbedFieldData {
  const title = Formatters.truncateText(entry.title, COLUMN_TITLE_LENGTH);
  const uploader = Formatters.escapeMarkdown(Formatters.truncateText(entry.uploader, 20));
  const duration = Formatters.formatInlineTimeHms(entry.duration, '`--:--`');
  return { name: `${label}. ${title}`, value: `${duration} ${uploader}`, inline: true };
}

function blankField(): EmbedFieldData {
  return { name: BLANK, value: BLANK, inline: true };
}

/**
 * Lay results out as a grid of paired inline fields: each row holds one
 * Bilibili and one YouTube entry (dual) or two consecutive entries
 * (single platform), closed by an invisible third field so Discord
 * starts a fresh 3-column row. Rows therefore stay top-aligned no matter
 * how far an individual title wraps.
 */
function buildFieldGrid(session: SearchSessionLike, page: number): EmbedFieldData[] {
  const fields: EmbedFieldData[] = [];

  if (session.mode === 'dual') {
    const bili = platformEntries(session, 'bilibili');
    const yt   = platformEntries(session, 'youtube');
    const pageStart = (page - 1) * RESULTS_PER_PAGE;
    for (let i = 0; i < RESULTS_PER_PAGE; i++) {
      const left  = bili[pageStart + i];
      const right = yt[pageStart + i];
      if (!left && !right) break;
      fields.push(left ? entryField(left, `B${pageStart + i + 1}`) : blankField());
      fields.push(right ? entryField(right, `Y${pageStart + i + 1}`) : blankField());
      fields.push(blankField());
    }
    return fields;
  }

  const pageStart = (page - 1) * RESULTS_PER_PAGE * 2;
  for (let row = 0; row < RESULTS_PER_PAGE; row++) {
    const leftIndex = pageStart + row * 2;
    const left  = session.entries[leftIndex];
    const right = session.entries[leftIndex + 1];
    if (!left) break;
    fields.push(entryField(left, String(leftIndex + 1)));
    fields.push(right ? entryField(right, String(leftIndex + 2)) : blankField());
    fields.push(blankField());
  }
  return fields;
}

function formatOptionDescription(entry: SearchSessionEntry, dual: boolean): string {
  const seconds = Formatters.parseDurationSeconds(entry.duration);
  const duration = seconds === null ? '--:--' : Formatters.formatTimeHms(seconds);
  const parts = dual
    ? [entry.platform === 'youtube' ? 'YouTube' : 'Bilibili', entry.uploader, duration]
    : [entry.uploader, duration];
  return parts.join(' | ');
}

function buildSelectRow(token: string, session: SearchSessionLike): ActionRowBuilder<StringSelectMenuBuilder> {
  const dual = session.mode === 'dual';
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`search_select_v2_${token}`)
    .setPlaceholder('选择要播放的视频…')
    .setMinValues(1)
    .setMaxValues(1);

  const platformCounters: Record<string, number> = {};
  const seenValues = new Set<string>();
  session.entries.slice(0, 25).forEach((entry, index) => {
    const indexInPlatform = platformCounters[entry.platform] ?? 0;
    platformCounters[entry.platform] = indexInPlatform + 1;
    // Duplicate option values are rejected by Discord; fall back to the
    // session index, which the select handler resolves via the entry URL.
    const value = seenValues.has(entry.selectionValue) ? `idx_${index}` : entry.selectionValue;
    seenValues.add(value);
    menu.addOptions({
      label: Formatters.truncateText(`${entryLabel(entry, indexInPlatform, dual)}. ${entry.title}`, 100),
      description: Formatters.truncateText(formatOptionDescription(entry, dual), 100),
      value,
    });
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function buildPageButtons(token: string, page: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`search_page_${token}_prev`)
      .setLabel('◀ 上一页')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`search_page_${token}_indicator`)
      .setLabel(`第 ${page}/${totalPages} 页`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`search_page_${token}_next`)
      .setLabel('下一页 ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
  );
}

function platformEntries(session: SearchSessionLike, platform: SearchSessionPlatform): SearchSessionEntry[] {
  return session.entries.filter((entry) => entry.platform === platform);
}

function totalPagesFor(session: SearchSessionLike): number {
  if (session.mode === 'dual') {
    // Each platform column pages independently at RESULTS_PER_PAGE per page.
    const biliPages = Math.ceil(platformEntries(session, 'bilibili').length / RESULTS_PER_PAGE);
    const ytPages   = Math.ceil(platformEntries(session, 'youtube').length / RESULTS_PER_PAGE);
    return Math.max(biliPages, ytPages, 1);
  }
  // Single platform fills both columns: 2 × RESULTS_PER_PAGE per page.
  return Math.max(1, Math.ceil(session.entries.length / (RESULTS_PER_PAGE * 2)));
}

/**
 * Build the embed + components payload for a search session page.
 */
function buildSearchResultsMessage(
  token: string,
  session: SearchSessionLike,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] } {
  const totalPages = totalPagesFor(session);
  const page = Math.min(Math.max(session.currentPage, 1), totalPages);

  const embed = new EmbedBuilder()
    .setTitle(`搜索结果「${Formatters.escapeMarkdown(session.keyword)}」`)
    .setDescription(`共 ${session.entries.length} 个结果 · 第 ${page}/${totalPages} 页`)
    .setColor(SEARCH_ACCENT_COLOR)
    .addFields(buildFieldGrid(session, page));

  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    buildSelectRow(token, session),
  ];
  if (totalPages > 1) {
    components.push(buildPageButtons(token, page, totalPages));
  }

  return { embeds: [embed], components };
}

export = {
  RESULTS_PER_PAGE,
  createSessionEntries,
  buildSearchResultsMessage,
  totalPagesFor,
};
