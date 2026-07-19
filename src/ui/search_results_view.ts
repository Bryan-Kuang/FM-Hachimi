/**
 * Search Results View
 * Renders paginated search results as a compact two-column embed: plain
 * `1.`-`N.` numbering over consecutive entries, 10 per page (`RESULTS_PER_PAGE`
 * rows × 2 columns). Single-platform searches (`/search`) and the dual-platform
 * interleaved keyword search (`/play`, mode `'mixed'`) share this layout — the
 * caller decides ordering (interleaved or not) before the entries land here.
 * A select menu over the *current page's* entries and page buttons sit below
 * the embed. Shared by /search, /play keyword search, and the page-button
 * handler.
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
type SearchSessionMode = SearchSessionPlatform | 'mixed';

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
  mode: SearchSessionMode;
  entries: SearchSessionEntry[];
  currentPage: number;
}

/**
 * Convert raw search results into session entries with precomputed
 * selection values. `startIndex` keeps the index fallback values unique
 * when entries from multiple platforms are concatenated into one session.
 * Note: fallback values are recomputed against each entry's final position
 * at render time (see `buildSelectRow`), so `startIndex` only needs to keep
 * values distinct at creation time — it does not need to predict any later
 * reordering (e.g. round-robin interleaving).
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
 * Lay results out as a grid of paired inline fields: each row holds two
 * consecutive entries, closed by an invisible third field so Discord starts
 * a fresh 3-column row. Rows therefore stay top-aligned no matter how far an
 * individual title wraps.
 */
function buildFieldGrid(session: SearchSessionLike, page: number): EmbedFieldData[] {
  const fields: EmbedFieldData[] = [];

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

function platformLabel(platform: SearchSessionPlatform): string {
  if (platform === 'youtube') return 'YouTube';
  return 'Bilibili';
}

function formatOptionDescription(entry: SearchSessionEntry, mixed: boolean): string {
  const seconds = Formatters.parseDurationSeconds(entry.duration);
  const duration = seconds === null ? '--:--' : Formatters.formatTimeHms(seconds);
  const parts = mixed
    ? [platformLabel(entry.platform), entry.uploader, duration]
    : [entry.uploader, duration];
  return parts.join(' | ');
}

/**
 * Options cover only the current page's entries (max `RESULTS_PER_PAGE * 2`),
 * labeled with the entry's absolute 1-based position in the whole session.
 * A fallback ("idx_<n>") value is always recomputed against that absolute
 * position rather than trusting whatever was baked in at entry-creation
 * time, since the caller may have reordered entries afterward (round-robin
 * interleaving) — only a resolvable platform identity ("bili:"/"yt:") is
 * stable across such reordering.
 */
function buildSelectRow(token: string, session: SearchSessionLike, page: number): ActionRowBuilder<StringSelectMenuBuilder> {
  const mixed = session.mode === 'mixed';
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`search_select_v2_${token}`)
    .setPlaceholder('选择要播放的视频…')
    .setMinValues(1)
    .setMaxValues(1);

  const pageStart = (page - 1) * RESULTS_PER_PAGE * 2;
  const pageEntries = session.entries.slice(pageStart, pageStart + RESULTS_PER_PAGE * 2);

  const seenValues = new Set<string>();
  pageEntries.forEach((entry, i) => {
    const absoluteIndex = pageStart + i;
    const isFallback = entry.selectionValue.startsWith('idx_');
    const candidate = isFallback ? `idx_${absoluteIndex}` : entry.selectionValue;
    // Duplicate option values are rejected by Discord; fall back to the
    // entry's absolute session index, which the select handler resolves
    // directly against session.entries.
    const value = seenValues.has(candidate) ? `idx_${absoluteIndex}` : candidate;
    seenValues.add(value);
    menu.addOptions({
      label: Formatters.truncateText(`${absoluteIndex + 1}. ${entry.title}`, 100),
      description: Formatters.truncateText(formatOptionDescription(entry, mixed), 100),
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

function totalPagesFor(session: SearchSessionLike): number {
  // Every mode (single-platform or mixed/interleaved) fills both columns:
  // 2 × RESULTS_PER_PAGE entries per page.
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
    buildSelectRow(token, session, page),
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
