/**
 * Resume Command
 * Resumes the paused audio playback
 */

import createSimpleCommand = require('./simple_command');

const createResumeCommand = createSimpleCommand({
  name: 'resume',
  description: '继续播放已暂停的音乐',
  cooldown: 2,
  label: 'Resume',
  action: (svc, guildId) => svc.resume(guildId) as boolean,
  successMsg: '> 已恢复',
  failMsg: '恢复失败',
});

export = createResumeCommand;
