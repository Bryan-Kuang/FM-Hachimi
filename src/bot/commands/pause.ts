/**
 * Pause Command
 * Pauses the currently playing audio
 */

import createSimpleCommand = require('./simple_command');

const createPauseCommand = createSimpleCommand({
  name: 'pause',
  description: '暂停当前播放',
  cooldown: 2,
  label: 'Pause',
  action: (svc, guildId) => svc.pause(guildId) as boolean,
  successMsg: '[||] 已暂停',
  failMsg: '暂停失败',
});

export = createPauseCommand;
