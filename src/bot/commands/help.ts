/**
 * Help Command - Display all available commands
 * Shows a list of all bot commands with descriptions
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import * as logger from '../../services/logger_service';

const createHelpCommand = (_playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('显示所有可用的命令'),

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      logger.info('Help command executed', {
        user: interaction.user.username,
        guild: interaction.guild?.name,
      });

      const helpEmbed = new EmbedBuilder()
        .setColor(0x00d4ff)
        .setTitle('Bilibili Music Bot - Commands')
        .setDescription('以下是所有可用的命令：')
        .addFields(
          {
            name: 'Playback',
            value:
              '`/play <URL>` - 播放Bilibili视频音频\n`/pause` - 暂停当前播放\n' +
              '`/resume` - 恢复播放\n`/stop` - 停止播放并清空队列',
            inline: false,
          },
          {
            name: 'Navigation',
            value: '`/skip` - 跳过当前歌曲\n`/prev` - 返回上一首\n`/queue` - 查看播放队列',
            inline: false,
          },
          {
            name: 'Search',
            value: '`/search <关键词>` - 搜索Bilibili视频\n`/nowplaying` - 查看当前播放的歌曲',
            inline: false,
          },
          {
            name: 'Features',
            value:
              '`/hachimi` - 自动添加哈基米精选视频\n`/daily-hachimi` - 配置每日哈基米推荐\n' +
              '`/radio` - 电台模式：无限随机播放哈基米歌曲\n' +
              '`/annoying` - 烦人模式：被踢出语音也会立刻回来继续播放',
            inline: false,
          },
        )
        .setFooter({ text: '使用各命令下方的按钮进行快速操作！' })
        .setTimestamp();

      await interaction.reply({
        embeds: [helpEmbed],
        flags: MessageFlags.Ephemeral,
      });
    } catch (e: unknown) {
      logger.error('Help command failed', { error: (e as Error).message });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Help command failed' });
        } else {
          await interaction.reply({ content: 'Help command failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createHelpCommand;
