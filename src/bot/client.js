/**
 * Discord Bot Client Setup
 * Initializes the Discord bot with proper intents and event handling
 */

const {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
  MessageFlags,
} = require("discord.js");
const logger = require("../services/logger_service");
const config = require("../config/config");
const PlayerControl = require("../control/player_control");
const PlaylistManager = require("../playlist/playlist_manager");
const InterfaceUpdater = require("../ui/interface_updater");
const Debug = require("../utils/debug");

class BotClient {
  constructor() {
    // Initialize Discord client with required intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Collections to store commands and cooldowns
    this.client.commands = new Collection();
    this.client.cooldowns = new Collection();

    // Store extractor instance for command access
    this.client.extractor = null;

    // Track bot status
    this.isReady = false;
    this.startTime = null;
  }

  /**
   * Initialize the bot client
   */
  async initialize() {
    try {
      logger.info("Initializing Discord bot client");
      Debug.trace('client.initialize.begin')

      // Set up event handlers
      this.setupEventHandlers();
      Debug.trace('client.events.bound')

      // Load commands
      await this.loadCommands();
      Debug.trace('client.commands.loaded')

      // Login to Discord
      await this.login();
      Debug.trace('client.login.done')

      try {
        PlayerControl.initialize(require("../audio/manager"));
        PlaylistManager.initialize(require("../audio/manager"));
        InterfaceUpdater.setClient(this.client);
        InterfaceUpdater.bind(PlayerControl);
        Debug.trace('client.bind.interface_updater')
      } catch (e) {
        logger.error("Failed to bind UI updater", { error: e.message });
        Debug.error('client.bind.failed', e)
      }

      logger.info("Discord bot client initialized successfully");
      Debug.trace('client.initialize.success')
      return true;
    } catch (error) {
      logger.error("Failed to initialize Discord bot client", {
        error: error.message,
        stack: error.stack,
      });
      Debug.error('client.initialize.failed', error)
      throw error;
    }
  }

  /**
   * Set up Discord event handlers
   */
  setupEventHandlers() {
    // Bot ready event
    this.client.once("clientReady", () => {
      this.isReady = true;
      this.startTime = new Date();

      logger.info("Discord bot is ready!", {
        username: this.client.user.username,
        id: this.client.user.id,
        guilds: this.client.guilds.cache.size,
      });
      Debug.trace('client.event.ready')

      // Set bot activity status
      this.client.user.setActivity("寻找蜂蜜饮料中...", {
        type: ActivityType.Custom,
      });
    });

    // Voice state update event - handle disconnects and debug logging
    this.client.on("voiceStateUpdate", (oldState, newState) => {
      logger.debug("Voice state update", {
        userId: newState.id,
        oldChannel: oldState.channelId,
        newChannel: newState.channelId,
      });
      Debug.trace('client.event.voiceStateUpdate', { userId: newState.id, oldChannel: oldState.channelId, newChannel: newState.channelId })

      // Check if bot was disconnected from a voice channel
      if (
        oldState.member.id === this.client.user.id &&
        oldState.channel &&
        !newState.channel
      ) {
        logger.info("Bot was disconnected from voice channel", {
          guild: oldState.guild.name,
          channel: oldState.channel.name,
        });

        // Clean up player state for this guild using proper method
        const AudioManager = require("../audio/manager");
        const player = AudioManager.getPlayer(oldState.guild.id);
        if (player) {
          player.stop();
          InterfaceUpdater.clearContext(oldState.guild.id);

          logger.info("Player stopped due to voice disconnect", {
            guild: oldState.guild.name,
          });
        }
      }
    });

    // Load interaction handlers
    const interactionHandler = require("./events/interactionCreate");

    // Interaction handling (slash commands, buttons, and select menus)
    this.client.on("interactionCreate", async (interaction) => {
      // Handle button interactions
      if (interaction.isButton()) {
        return await interactionHandler.execute(interaction);
      }

      // Handle select menu interactions
      if (interaction.isStringSelectMenu()) {
        return await interactionHandler.execute(interaction);
      }

      // Handle slash commands
      if (!interaction.isChatInputCommand()) return;

      const command = this.client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn("Unknown command received", {
          commandName: interaction.commandName,
          userId: interaction.user.id,
        });
        return;
      }

      try {
        // Check cooldowns
        if (this.checkCooldown(interaction, command)) {
          return;
        }

        // Execute command
        await command.execute(interaction);

        logger.info("Command executed successfully", {
          command: interaction.commandName,
          user: interaction.user.username,
          guild: interaction.guild?.name,
        });
      } catch (error) {
        logger.error("Command execution failed", {
          command: interaction.commandName,
          user: interaction.user.username,
          error: error.message,
          stack: error.stack,
        });

        const errorMessage =
          "Sorry, there was an error executing this command!";

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: errorMessage,
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content: errorMessage,
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    });

    // Error handling
    this.client.on("error", (error) => {
      logger.error("Discord client error", {
        error: error.message,
        stack: error.stack,
      });
      Debug.error('client.event.error', error)
    });

    this.client.on("warn", (warning) => {
      logger.warn("Discord client warning", { warning });
      Debug.trace('client.event.warn', { warning })
    });
  }

  /**
   * Load slash commands
   */
  async loadCommands() {
    const commands = [
      require("./commands/play"),
      require("./commands/pause"),
      require("./commands/resume"),
      require("./commands/skip"),
      require("./commands/prev"),
      require("./commands/stop"),
      require("./commands/queue"),
      require("./commands/nowplaying"),
      require("./commands/help"),
      require("./commands/search"),
      require("./commands/hachimi"),
    ];

    for (const command of commands) {
      try {
        if (command.data && command.execute) {
          this.client.commands.set(command.data.name, command);
          logger.debug("Loaded command", { name: command.data.name });
        } else {
          logger.warn("Invalid command structure", { command });
        }
      } catch (e) {
        Debug.error('command.load.failed', e)
        throw e
      }
    }

    logger.info("Commands loaded", {
      count: this.client.commands.size,
    });
    Debug.trace('client.commands.count', { count: this.client.commands.size })
  }

  /**
   * Check command cooldowns
   */
  checkCooldown(interaction, command) {
    const cooldownAmount = (command.cooldown || 3) * 1000; // Default 3 seconds
    const timestamps = this.client.cooldowns;

    if (!timestamps.has(command.data.name)) {
      timestamps.set(command.data.name, new Collection());
    }

    const now = Date.now();
    const commandTimestamps = timestamps.get(command.data.name);
    const userId = interaction.user.id;

    if (commandTimestamps.has(userId)) {
      const expirationTime = commandTimestamps.get(userId) + cooldownAmount;

      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        interaction.reply({
          content: `Please wait ${timeLeft.toFixed(
            1
          )} more second(s) before reusing the \`${
            command.data.name
          }\` command.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
    }

    commandTimestamps.set(userId, now);
    setTimeout(() => commandTimestamps.delete(userId), cooldownAmount);
    return false;
  }

  /**
   * Login to Discord
   */
  async login() {
    if (!config.discord.token) {
      throw new Error("Discord token is not configured");
    }

    try {
      await this.client.login(config.discord.token);
      logger.info("Successfully logged in to Discord");
      Debug.trace('client.login.success')
    } catch (error) {
      logger.error("Failed to login to Discord", {
        error: error.message,
        code: error.code,
      });
      Debug.error('client.login.failed', error)
      throw error;
    }
  }

  /**
   * Set the Bilibili extractor instance
   */
  setExtractor(extractor) {
    this.client.extractor = extractor;
    logger.info("Bilibili extractor attached to Discord client");
  }

  /**
   * Get bot statistics
   */
  getStats() {
    if (!this.isReady) {
      return {
        ready: false,
        uptime: 0,
        guilds: 0,
        users: 0,
      };
    }

    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;

    return {
      ready: true,
      uptime: Math.floor(uptime / 1000), // in seconds
      guilds: this.client.guilds.cache.size,
      users: this.client.users.cache.size,
      username: this.client.user.username,
      id: this.client.user.id,
    };
  }

  /**
   * Gracefully shutdown the bot
   */
  async shutdown() {
    logger.info("Shutting down Discord bot");

    try {
      if (this.client && this.isReady) {
        await this.client.destroy();
      }

      logger.info("Discord bot shutdown complete");
    } catch (error) {
      logger.error("Error during bot shutdown", {
        error: error.message,
      });
    }
  }

  /**
   * Get the Discord client instance
   */
  getClient() {
    return this.client;
  }
}

module.exports = BotClient;
