/**
 * Previous Command
 * Goes back to the previous track in the queue
 */

import createSimpleCommand = require('./simple_command');

const createPrevCommand = createSimpleCommand({
  name: 'prev',
  description: '播放队列中的上一首',
  cooldown: 3,
  label: 'Prev',
  action: (svc, guildId) => svc.previous(guildId) as Promise<boolean>,
  successMsg: '|< 已返回上一首',
  failMsg: '没有上一首',
  errorMsg: 'Previous failed',
});

export = createPrevCommand;
