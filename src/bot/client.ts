/**
 * Discord Bot Client Setup
 * Initializes the Discord bot with proper intents and event handling
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
  MessageFlags,
  ChatInputCommandInteraction,
  VoiceState,
} from 'discord.js';
import * as logger from '../services/logger_service';
import config = require('../config/config');
import Debug = require('../utils/debug');
import CommandRegistry = require('./commands');
import * as TestingAccess from './testing_access';
import { isFirstListenerJoin } from './voice_presence';

// Augment discord.js Client with bot-specific properties
declare module 'discord.js' {
  interface Client {
    commands:  Collection<string, CommandDef>;
    cooldowns: Collection<string, Collection<string, number>>;
    extractor: any | null;
  }
}

interface CommandDef {
  data:     { name: string };
  execute:  (interaction: ChatInputCommandInteraction<'cached'>) => Promise<void>;
  cooldown?: number;
  stage?: 'stable' | 'testing';
  featureName?: string;
}

interface BotStats {
  ready:     boolean;
  uptime:    number;
  guilds:    number;
  users:     number;
  username?: string;
  id?:       string;
}

class BotClient {
  private playerService:       any;
  private dailyHachimiService: any;
  private worldCupService:     any;
  public  client:    Client;
  public  isReady:   boolean;
  private startTime: Date | null;

  /**
   * @param playerService        - PlayerService (unified playback + queue)
   * @param dailyHachimiService  - DailyHachimiService instance (optional)
   * @param worldCupService      - WorldCupService instance (optional)
   */
  constructor(playerService: any, dailyHachimiService?: any, worldCupService?: any) {
    this.playerService       = playerService;
    this.dailyHachimiService = dailyHachimiService ?? null;
    this.worldCupService     = worldCupService ?? null;

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
    this.client.commands  = new Collection<string, CommandDef>();
    this.client.cooldowns = new Collection<string, Collection<string, number>>();

    // Store extractor instance for command access
    this.client.extractor = null;

    // Track bot status
    this.isReady   = false;
    this.startTime = null;
  }

  /**
   * Initialize the bot client
   * @param interfaceUpdater - InterfaceUpdater instance
   */
  async initialize(interfaceUpdater: any): Promise<boolean> {
    try {
      logger.info('Initializing Discord bot client');
      Debug.trace('client.initialize.begin');

      this.setupEventHandlers();
      Debug.trace('client.events.bound');

      await this.loadCommands();
      Debug.trace('client.commands.loaded');

      await this.login();
      Debug.trace('client.login.done');

      try {
        interfaceUpdater.setClient(this.client);
        interfaceUpdater.bind(this.playerService);
        Debug.trace('client.bind.interface_updater');
      } catch (e: unknown) {
        logger.error('Failed to bind UI updater', { error: (e as Error).message });
        Debug.error('client.bind.failed', e as Error);
      }

      logger.info('Discord bot client initialized successfully');
      Debug.trace('client.initialize.success');
      return true;
    } catch (error: unknown) {
      logger.error('Failed to initialize Discord bot client', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      Debug.error('client.initialize.failed', error as Error);
      throw error;
    }
  }

  /**
   * Set up Discord event handlers
   */
  setupEventHandlers(): void {
    const playerService = this.playerService;

    // Bot ready event
    this.client.once('clientReady', () => {
      this.isReady   = true;
      this.startTime = new Date();

      logger.info('Discord bot is ready!', {
        username: this.client.user!.username,
        id:       this.client.user!.id,
        guilds:   this.client.guilds.cache.size,
      });
      Debug.trace('client.event.ready');

      this.client.user!.setActivity('寻找蜂蜜饮料中...', {
        type: ActivityType.Custom,
      });
    });

    // Voice state update event — handle disconnects and debug logging
    this.client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
      logger.debug('Voice state update', {
        userId:     newState.id,
        oldChannel: oldState.channelId,
        newChannel: newState.channelId,
      });
      Debug.trace('client.event.voiceStateUpdate', {
        userId:     newState.id,
        oldChannel: oldState.channelId,
        newChannel: newState.channelId,
      });

      // A listener arrived in the channel the bot is playing to alone: repost
      // the now-playing card so it isn't buried under later chat. Only fires on
      // the empty→occupied transition (first human), and is throttled inside
      // repostNowPlaying so join/leave flapping can't spam the channel.
      const botUserId = this.client.user?.id;
      if (botUserId && isFirstListenerJoin(oldState as any, newState as any, botUserId)) {
        playerService.repostNowPlaying?.(newState.guild.id)?.catch((err: Error) => {
          logger.warn('Failed to repost now-playing card on listener join', { error: err.message });
        });
      }

      const annoyingService = playerService.getAnnoyingService?.();

      // Bot was server-muted/deafened — annoying mode clears it. No early
      // return: a combined event (muted while being dragged) must still fall
      // through to the move branch below.
      if (
        oldState.member?.id === this.client.user?.id &&
        newState.channel &&
        ((!oldState.serverMute && newState.serverMute) ||
          (!oldState.serverDeaf && newState.serverDeaf))
      ) {
        annoyingService?.handleBotMuteDeafen(oldState, newState)?.catch((err: Error) => {
          logger.warn('Annoying mode: mute/deafen handling failed', { error: err.message });
        });
      }

      // Bot was dragged to another voice channel — annoying mode moves it back.
      if (
        oldState.member?.id === this.client.user?.id &&
        oldState.channel &&
        newState.channel &&
        oldState.channelId !== newState.channelId
      ) {
        annoyingService?.handleBotMove(oldState, newState)?.catch((err: Error) => {
          logger.warn('Annoying mode: move handling failed', { error: err.message });
        });
        return;
      }

      // Check if bot was disconnected from a voice channel
      if (
        oldState.member?.id === this.client.user?.id &&
        oldState.channel &&
        !newState.channel
      ) {
        logger.info('Bot was disconnected from voice channel', {
          guild:   oldState.guild.name,
          channel: oldState.channel.name,
        });

        // Annoying mode decides BEFORE teardown — it snapshots the live queue
        // that leaveVoiceChannel() below is about to wipe, and schedules the
        // rejoin when the disconnect is hostile.
        if (annoyingService) {
          try {
            await annoyingService.handleBotDisconnect(oldState);
          } catch (err: unknown) {
            logger.warn('Annoying mode: disconnect handling failed', {
              error: (err as Error).message,
            });
          }
        }

        const player = playerService.getPlayer(oldState.guild.id);

        if (player) {
          // Radio mode must be flagged off before teardown, otherwise the next
          // /radio toggles the stale "enabled" state off instead of starting.
          // (The annoying-mode restore re-arms it from the snapshot.)
          playerService.getRadioService?.()?.stop(oldState.guild.id)?.catch((err: Error) => {
            logger.warn('Failed to stop radio mode on voice disconnect', { error: err.message });
          });
          // Use leaveVoiceChannel (not stop) so voiceConnection is cleared immediately
          player.leaveVoiceChannel();
          playerService.clearUIContext(oldState.guild.id);

          logger.info('Player torn down due to voice disconnect', {
            guild: oldState.guild.name,
          });
        }
      }
    });

    // Load interaction handlers
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const createInteractionHandler = require('./events/interactionCreate') as (
      ps: any,
    ) => { execute: (i: any) => Promise<void> };
    const interactionHandler = createInteractionHandler(playerService);

    // Interaction handling (slash commands, buttons, and select menus)
    this.client.on('interactionCreate', async (interaction: any) => {
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
        logger.warn('Unknown command received', {
          commandName: interaction.commandName,
          userId:      interaction.user.id,
        });
        return;
      }

      try {
        if (TestingAccess.isTestingCommand(command)) {
          const allowed = await TestingAccess.assertTestingGuild(
            interaction,
            command.featureName || command.data.name,
          );
          if (!allowed) return;
        }

        if (await this.checkCooldown(interaction, command)) return;

        await command.execute(interaction);

        logger.info('Command executed successfully', {
          command: interaction.commandName,
          user:    interaction.user.username,
          guild:   interaction.guild?.name,
        });
      } catch (error: unknown) {
        logger.error('Command execution failed', {
          command: interaction.commandName,
          user:    interaction.user.username,
          error:   (error as Error).message,
          stack:   (error as Error).stack,
        });

        const errorMessage = 'Sorry, there was an error executing this command!';

        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
          } else {
            await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
          }
        } catch (replyError: unknown) {
          logger.warn('Failed to send error reply to user', {
            originalError: (error as Error).message,
            replyError: (replyError as Error).message,
          });
        }
      }
    });

    // Error handling
    this.client.on('error', (error: Error) => {
      logger.error('Discord client error', { error: error.message, stack: error.stack });
      Debug.error('client.event.error', error);
    });

    this.client.on('warn', (warning: string) => {
      logger.warn('Discord client warning', { warning });
      Debug.trace('client.event.warn', { warning });
    });
  }

  /**
   * Load slash commands.
   */
  async loadCommands(): Promise<void> {
    const commands = CommandRegistry.createCommands(this.playerService, this.dailyHachimiService, this.worldCupService);

    for (const command of commands) {
      try {
        const candidate = command as Partial<CommandDef>;
        if (candidate.data && candidate.execute) {
          this.client.commands.set(candidate.data.name, candidate as CommandDef);
          logger.debug('Loaded command', { name: candidate.data.name });
        } else {
          logger.warn('Invalid command structure', { command });
        }
      } catch (e: unknown) {
        Debug.error('command.load.failed', e as Error);
        throw e;
      }
    }

    logger.info('Commands loaded', { count: this.client.commands.size });
    Debug.trace('client.commands.count', { count: this.client.commands.size });
  }

  /**
   * Check command cooldowns
   */
  async checkCooldown(interaction: any, command: CommandDef): Promise<boolean> {
    const cooldownAmount = (command.cooldown ?? 3) * 1000;
    const timestamps     = this.client.cooldowns;

    if (!timestamps.has(command.data.name)) {
      timestamps.set(command.data.name, new Collection<string, number>());
    }

    const now               = Date.now();
    const commandTimestamps = timestamps.get(command.data.name)!;
    const userId            = interaction.user.id as string;

    if (commandTimestamps.has(userId)) {
      const storedTime     = commandTimestamps.get(userId)!;
      const expirationTime = storedTime + cooldownAmount;

      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        await interaction.reply({
          content: `Please wait ${timeLeft.toFixed(1)} more second(s) before reusing the \`${command.data.name}\` command.`,
          flags:   MessageFlags.Ephemeral,
        }).catch((err: Error) => {
          logger.warn('Failed to send cooldown message', { error: err.message });
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
  async login(): Promise<void> {
    if (!config.discord.token) {
      throw new Error('Discord token is not configured');
    }

    try {
      await this.client.login(config.discord.token);
      logger.info('Successfully logged in to Discord');
      Debug.trace('client.login.success');
    } catch (error: unknown) {
      logger.error('Failed to login to Discord', {
        error: (error as Error).message,
        code:  (error as any).code,
      });
      Debug.error('client.login.failed', error as Error);
      throw error;
    }
  }

  /**
   * Set the Bilibili extractor instance
   */
  setExtractor(extractor: any): void {
    this.client.extractor = extractor;
    logger.info('Bilibili extractor attached to Discord client');
  }

  /**
   * Get bot statistics
   */
  getStats(): BotStats {
    if (!this.isReady) {
      return { ready: false, uptime: 0, guilds: 0, users: 0 };
    }

    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;

    return {
      ready:    true,
      uptime:   Math.floor(uptime / 1000),
      guilds:   this.client.guilds.cache.size,
      users:    this.client.users.cache.size,
      username: this.client.user?.username,
      id:       this.client.user?.id,
    };
  }

  /**
   * Gracefully shutdown the bot
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Discord bot');
    try {
      if (this.isReady) {
        await this.client.destroy();
      }
      logger.info('Discord bot shutdown complete');
    } catch (error: unknown) {
      logger.error('Error during bot shutdown', { error: (error as Error).message });
    }
  }

  /**
   * Get the Discord client instance
   */
  getClient(): Client {
    return this.client;
  }
}

export = BotClient;
