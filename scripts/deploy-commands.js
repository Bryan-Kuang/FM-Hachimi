/**
 * Deploy Discord Slash Commands
 * Registers slash commands with Discord API
 */

const { REST, Routes } = require("discord.js");
const config = require("../src/config/config");
const logger = require("../src/utils/logger");

// Import all commands
const commands = [
  require("../src/bot/commands/play"),
  require("../src/bot/commands/pause"),
  require("../src/bot/commands/resume"),
  require("../src/bot/commands/skip"),
  require("../src/bot/commands/prev"),
  require("../src/bot/commands/stop"),
  require("../src/bot/commands/queue"),
  require("../src/bot/commands/nowplaying"),
  require("../src/bot/commands/help"),
];

async function deployCommands() {
  try {
    // Validate configuration
    if (!config.discord.token || !config.discord.clientId) {
      throw new Error("Discord token or client ID is not configured");
    }

    // Extract command data
    const commandData = commands.map((command) => command.data.toJSON());

    logger.info("Starting command deployment", {
      commandCount: commandData.length,
      commands: commandData.map((cmd) => cmd.name),
    });

    // Create REST client
    const rest = new REST({ version: "10" }).setToken(config.discord.token);

    if (config.discord.guildId) {
      // Deploy to specific guild (faster for development)
      logger.info("Deploying commands to guild", {
        guildId: config.discord.guildId,
      });

      await rest.put(
        Routes.applicationGuildCommands(
          config.discord.clientId,
          config.discord.guildId
        ),
        { body: commandData }
      );

      logger.info("Successfully deployed guild commands");
    } else {
      // Deploy globally (takes up to 1 hour to update)
      logger.info("Deploying commands globally");

      await rest.put(Routes.applicationCommands(config.discord.clientId), {
        body: commandData,
      });

      logger.info("Successfully deployed global commands");
    }

    // Log deployed commands
    commandData.forEach((command) => {
      logger.info("Deployed command", {
        name: command.name,
        description: command.description,
        options: command.options?.length || 0,
      });
    });

    logger.info("Command deployment completed successfully");
  } catch (error) {
    logger.error("Failed to deploy commands", {
      error: error.message,
      stack: error.stack,
    });

    if (error.code === 50001) {
      logger.error(
        "Missing access: Bot may not have permission to create commands in this guild"
      );
    } else if (error.code === 10062) {
      logger.error(
        "Unknown interaction: The interaction may have expired or been deleted"
      );
    } else if (error.status === 429) {
      logger.error("Rate limited: Too many requests. Try again later");
    }

    process.exit(1);
  }
}

// Run deployment if called directly
if (require.main === module) {
  deployCommands();
}

module.exports = { deployCommands };
