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
const TestingAccess = require("../src/bot/testing_access");

function toCommandData(commands) {
  return commands.map((command) => command.data.toJSON());
}

function createDeploymentPlan(env = process.env) {
  const deployTesting = env.DEPLOY_TEST_COMMANDS === "true";
  const deployLegacyGuild = env.DEPLOY_LEGACY_GUILD_COMMANDS === "true";
  const clear = env.CLEAR_GUILD_COMMANDS === "true";

  if (deployTesting && deployLegacyGuild) {
    throw new Error("DEPLOY_TEST_COMMANDS and DEPLOY_LEGACY_GUILD_COMMANDS cannot both be true");
  }

  if (deployTesting) {
    if (!TestingAccess.TEST_GUILD_ID) {
      throw new Error(
        "TEST_GUILD_ID is required when DEPLOY_TEST_COMMANDS=true (no hardcoded fallback)"
      );
    }
    const commands = clear ? [] : CommandRegistry.getGuildCommandsForTestServer(null, null);
    return {
      scope: "test_guild",
      guildId: TestingAccess.TEST_GUILD_ID,
      clear,
      commandData: toCommandData(commands),
    };
  }

  if (deployLegacyGuild) {
    if (!config.discord.guildId) {
      throw new Error("GUILD_ID is required when DEPLOY_LEGACY_GUILD_COMMANDS=true");
    }
    const commands = clear ? [] : CommandRegistry.createCommands(null, null);
    return {
      scope: "legacy_guild",
      guildId: config.discord.guildId,
      clear,
      commandData: toCommandData(commands),
    };
  }

  if (clear) {
    throw new Error("CLEAR_GUILD_COMMANDS requires DEPLOY_TEST_COMMANDS=true or DEPLOY_LEGACY_GUILD_COMMANDS=true");
  }

  return {
    scope: "global",
    guildId: null,
    clear: false,
    commandData: toCommandData(CommandRegistry.getGlobalCommands(null, null)),
  };
}

async function deployCommands() {
  try {
    // Validate configuration
    if (!config.discord.token || !config.discord.clientId) {
      throw new Error("Discord token or client ID is not configured");
    }

    const plan = createDeploymentPlan(process.env);
    const { commandData } = plan;

    logger.info("Starting command deployment", {
      scope: plan.scope,
      guildId: plan.guildId,
      clear: plan.clear,
      commandCount: commandData.length,
      commands: commandData.map((cmd) => cmd.name),
    });

    // Create REST client
    const rest = new REST({ version: "10" }).setToken(config.discord.token);

    if (plan.clear) {
      logger.info("Clearing guild-scoped commands", {
        scope: plan.scope,
        guildId: plan.guildId,
      });
      await rest.put(
        Routes.applicationGuildCommands(
          config.discord.clientId,
          plan.guildId
        ),
        { body: [] }
      );
      logger.info("Guild commands cleared — duplicates should be gone within seconds", {
        scope: plan.scope,
        guildId: plan.guildId,
      });
      return;
    }

    if (plan.guildId) {
      logger.info("Deploying guild-scoped commands", {
        scope: plan.scope,
        guildId: plan.guildId,
      });

      await rest.put(
        Routes.applicationGuildCommands(
          config.discord.clientId,
          plan.guildId
        ),
        { body: commandData }
      );

      logger.info("Successfully deployed guild commands", {
        scope: plan.scope,
        guildId: plan.guildId,
      });
    } else {
      logger.info("Deploying stable commands globally");

      await rest.put(Routes.applicationCommands(config.discord.clientId), {
        body: commandData,
      });

      logger.info("Successfully deployed global stable commands");
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
module.exports.createDeploymentPlan = createDeploymentPlan;
