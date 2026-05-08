/**
 * Deploy Discord Slash Commands
 * Registers slash commands with Discord API
 */

// Register ts-node so require() can load TypeScript source files directly.
// transpileOnly skips type-checking for speed (tsc --noEmit handles that separately).
require("ts-node").register({ transpileOnly: true });

const { REST, Routes } = require("discord.js");
const config = require("../src/config/config");
const logger = require("../src/services/logger_service");
const CommandRegistry = require("../src/bot/commands");

async function deployCommands() {
  try {
    // Validate configuration
    if (!config.discord.token || !config.discord.clientId) {
      throw new Error("Discord token or client ID is not configured");
    }

    // Command factories receive services at runtime; deploy only needs the data builders.
    const commands = CommandRegistry.createCommands(null, null);

    // Extract command data
    const commandData = commands.map((command) => command.data.toJSON());

    logger.info("Starting command deployment", {
      commandCount: commandData.length,
      commands: commandData.map((cmd) => cmd.name),
    });

    // Create REST client
    const rest = new REST({ version: "10" }).setToken(config.discord.token);

    // clear_guild mode: wipe all guild-scoped commands from a specific server.
    // Use this to fix duplicate commands when switching from guild to global deploy.
    if (process.env.CLEAR_GUILD_COMMANDS === "true") {
      if (!config.discord.guildId) {
        throw new Error("GUILD_ID is required for clear_guild mode");
      }
      logger.info("Clearing guild-scoped commands", {
        guildId: config.discord.guildId,
      });
      await rest.put(
        Routes.applicationGuildCommands(
          config.discord.clientId,
          config.discord.guildId
        ),
        { body: [] }
      );
      logger.info("Guild commands cleared — duplicates should be gone within seconds", {
        guildId: config.discord.guildId,
      });
      return;
    }

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
