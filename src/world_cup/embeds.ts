/**
 * World Cup embed builders. Kept in the world_cup module (not ui/embeds.ts) so
 * the Match type stays local and ui/embeds.ts doesn't take a dependency on the
 * temporal feature.
 */

import { EmbedBuilder } from 'discord.js';
import type { Match, EventKind } from './types';

const WC_COLOR = 0x326295; // FIFA blue
const LIVE_COLOR = 0x1DB954; // green for live events

/** "🔴 67' · Argentina 2–1 Saudi Arabia · Group C" */
function matchLine(m: Match): string {
  const score = `${m.home.name} ${m.home.score}–${m.away.score} ${m.away.name}`;
  let prefix: string;
  if (m.status === 'live') prefix = `🔴 ${m.clock || 'LIVE'}`;
  else if (m.status === 'final') prefix = '✅ FT';
  else prefix = `⏰ ${formatKickoff(m.utcDate)}`;
  const group = m.group ? ` · ${m.group}` : '';
  return `${prefix} · **${score}**${group}`;
}

function formatKickoff(utcDate: string): string {
  const t = Date.parse(utcDate);
  if (!Number.isFinite(t)) return 'TBD';
  // Discord renders <t:unix:t> in each viewer's local timezone.
  return `<t:${Math.floor(t / 1000)}:t>`;
}

/** A list of fixtures/results for a day (the on-demand / backup path output). */
function buildMatchListEmbed(matches: Match[], label: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(WC_COLOR).setTitle(`🏆 World Cup — ${label}`);

  if (matches.length === 0) {
    embed.setDescription('No matches scheduled.');
    return embed;
  }

  const sorted = [...matches].sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
  embed.setDescription(sorted.map(matchLine).join('\n').slice(0, 4096));
  return embed;
}

/** A single live event push (kickoff / goal / full-time). */
function buildEventEmbed(m: Match, kind: EventKind, side?: 'home' | 'away'): EmbedBuilder {
  const score = `${m.home.name} ${m.home.score}–${m.away.score} ${m.away.name}`;
  const group = m.group ? ` (${m.group})` : '';
  let title: string;

  if (kind === 'kickoff') {
    title = `🟢 Kickoff — ${m.home.name} vs ${m.away.name}${group}`;
  } else if (kind === 'goal') {
    const scorer = side === 'home' ? m.home.name : m.away.name;
    title = `⚽ GOAL! ${scorer} — ${score}`;
  } else {
    title = `🏁 Full-time — ${score}${group}`;
  }

  const embed = new EmbedBuilder()
    .setColor(kind === 'fulltime' ? WC_COLOR : LIVE_COLOR)
    .setTitle(title.slice(0, 256));
  if (kind === 'goal' && m.clock) embed.setDescription(`${m.clock}${group}`);
  return embed;
}

export = { buildMatchListEmbed, buildEventEmbed, matchLine };
