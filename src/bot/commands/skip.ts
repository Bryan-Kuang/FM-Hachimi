/**
 * Skip Command
 * Skips to the next track in the queue
 */

import createSimpleCommand = require('./simple_command');
import { RADIO_BREAK_MESSAGE } from '../../playback/radio_controls';

const createSkipCommand = createSimpleCommand({
  name: 'skip',
  description: '跳过当前歌曲，播放下一首',
  cooldown: 3,
  label: 'Skip',
  // The periodic radio "take a break" video is non-skippable.
  guard: (svc, interaction) =>
    svc.getRadioService?.()?.isOnBreak(interaction.guild.id) ? RADIO_BREAK_MESSAGE : null,
  action: (svc, guildId) => svc.skip(guildId) as Promise<boolean>,
  successMsg: '>> 已跳过',
  failMsg: '没有下一首',
});

export = createSkipCommand;
