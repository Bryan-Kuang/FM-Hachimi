/**
 * Queue Command
 * Displays the current music queue
 */

const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilders = require("../../ui/embeds");
const ButtonBuilders = require("../../ui/buttons");
const AudioManager = require("../../audio/manager");
const logger = require("../../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Display the current music queue"),

  cooldown: 3,

  async execute(interaction) {
    try {
      const user = interaction.user;

      // Get actual queue from audio manager
      const queueInfo = AudioManager.getQueue(interaction.guild.id);

      // Create queue embed
      const queueEmbed = EmbedBuilders.createQueueEmbed(
        queueInfo.queue,
        queueInfo.state.currentIndex
      );

      // Create queue management buttons
      const queueButtons = ButtonBuilders.createQueueControls({
        hasQueue: queueInfo.state.queueLength > 0,
        queueLength: queueInfo.state.queueLength,
      });

      await interaction.reply({
        embeds: [queueEmbed],
        components: [queueButtons],
      });

      logger.info("Queue command executed successfully", {
        user: user.username,
        queueLength: queueInfo.state.queueLength,
      });
    } catch (error) {
      logger.error("Queue command failed", {
        user: interaction.user.username,
        error: error.message,
        stack: error.stack,
      });

      const errorEmbed = EmbedBuilders.createErrorEmbed(
        "Queue Display Failed",
        "Failed to display the current queue.",
        {
          errorCode: "QUEUE_FAILED",
        }
      );

      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }
  },
};
