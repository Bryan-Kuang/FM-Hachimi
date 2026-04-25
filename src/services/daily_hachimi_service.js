/**
 * DailyHachimiService
 * 每日定时在指定频道发送哈基米音乐推荐卡片。
 * 每个 guild 独立配置，默认全部关闭，由管理员通过 /daily-hachimi 命令配置。
 */

const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const logger = require("./logger_service");
const Formatters = require("../utils/formatters");

class DailyHachimiService {
  /**
   * @param {Object} config - App config object (src/config/config.js)
   */
  constructor(config) {
    this.config = config;
    /** @type {Map<string, import('node-cron').ScheduledTask>} */
    this.cronJobs = new Map();
    /** @type {Object.<string, {channelId: string, hour: number, minute: number, count: number, timezone: string}>} */
    this.schedules = {};

    this.client = null;
    this.bilibiliApi = null;

    this._dataFile = config.dailyHachimi?.dataFile
      || path.join(process.cwd(), "data", "daily_hachimi.json");
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Initialize: store client/api references, load persisted schedules, start crons.
   * @param {import('discord.js').Client} discordClient
   * @param {Object} bilibiliApi
   */
  initialize(discordClient, bilibiliApi) {
    this.client = discordClient;
    this.bilibiliApi = bilibiliApi;

    this._loadSchedules();

    for (const [guildId, cfg] of Object.entries(this.schedules)) {
      this._scheduleGuild(guildId, cfg);
    }

    logger.info("DailyHachimiService initialized", {
      guildsScheduled: Object.keys(this.schedules).length,
    });
  }

  /**
   * Set or update a guild's daily schedule.
   * @param {string} guildId
   * @param {{channelId: string, hour: number, minute: number, count: number, timezone: string}} cfg
   */
  setSchedule(guildId, cfg) {
    // Stop existing cron if any
    this._stopCron(guildId);

    this.schedules[guildId] = cfg;
    this._saveSchedules();
    this._scheduleGuild(guildId, cfg);

    logger.info("Daily Hachimi schedule set", { guildId, ...cfg });
  }

  /**
   * Remove a guild's daily schedule.
   * @param {string} guildId
   */
  removeSchedule(guildId) {
    this._stopCron(guildId);
    delete this.schedules[guildId];
    this._saveSchedules();
    logger.info("Daily Hachimi schedule removed", { guildId });
  }

  /**
   * Get a guild's current schedule config, or null if not configured.
   * @param {string} guildId
   * @returns {{channelId: string, hour: number, minute: number, count: number, timezone: string}|null}
   */
  getStatus(guildId) {
    return this.schedules[guildId] || null;
  }

  // ---------------------------------------------------------------------------
  // Internal scheduling
  // ---------------------------------------------------------------------------

  /**
   * Create and store the cron job for a guild.
   */
  _scheduleGuild(guildId, cfg) {
    const { hour, minute, timezone } = cfg;
    const expression = `${minute} ${hour} * * *`;

    try {
      const task = cron.schedule(expression, () => {
        this._fire(guildId).catch((err) => {
          logger.error("DailyHachimi _fire threw unexpected error", {
            guildId,
            error: err.message,
            stack: err.stack,
          });
        });
      }, { timezone });

      this.cronJobs.set(guildId, task);
      logger.debug("Daily Hachimi cron scheduled", { guildId, expression, timezone });
    } catch (err) {
      logger.error("Failed to schedule daily hachimi cron", {
        guildId,
        expression,
        timezone,
        error: err.message,
      });
    }
  }

  /** Stop and delete a guild's cron job if it exists. */
  _stopCron(guildId) {
    const task = this.cronJobs.get(guildId);
    if (task) {
      task.stop();
      this.cronJobs.delete(guildId);
    }
  }

  // ---------------------------------------------------------------------------
  // Fire: send daily recommendation cards
  // ---------------------------------------------------------------------------

  /**
   * Triggered by the cron job. Fetches videos and sends cards to the channel.
   * @param {string} guildId
   */
  async _fire(guildId) {
    const cfg = this.schedules[guildId];
    if (!cfg) return;

    const { channelId, count } = cfg;

    logger.info("Firing daily Hachimi recommendation", { guildId, channelId, count });

    // Fetch the Discord channel
    let channel;
    try {
      channel = await this.client.channels.fetch(channelId);
    } catch (err) {
      logger.error("DailyHachimi: failed to fetch channel — schedule may have been deleted", {
        guildId,
        channelId,
        error: err.message,
      });
      return;
    }

    if (!channel || !channel.isTextBased()) {
      logger.error("DailyHachimi: channel is not text-based", { guildId, channelId });
      return;
    }

    // Search for videos
    let videos;
    try {
      const { results } = await this.bilibiliApi.searchHachimiVideos(count, guildId);
      videos = results;
    } catch (err) {
      logger.error("DailyHachimi: searchHachimiVideos threw", {
        guildId,
        error: err.message,
      });
      return;
    }

    if (!videos || videos.length === 0) {
      logger.warn("DailyHachimi: no videos returned by API, skipping send", { guildId });
      return;
    }

    // Format today's date
    const today = new Date().toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: cfg.timezone || this.config.dailyHachimi?.defaultTimezone || "America/Toronto",
    });

    // Send header message
    try {
      await channel.send(`🎵 今日哈基米音乐推荐 · ${today}`);
    } catch (err) {
      logger.error("DailyHachimi: failed to send header message", {
        guildId,
        error: err.message,
      });
      return;
    }

    // Send one card per video
    for (const video of videos) {
      try {
        const embed = this._buildVideoEmbed(video);
        const row = this._buildActionRow(video);
        await channel.send({ embeds: [embed], components: [row] });
      } catch (err) {
        logger.error("DailyHachimi: failed to send video card", {
          guildId,
          bvid: video.bvid,
          error: err.message,
        });
        // Continue sending remaining cards
      }
    }

    logger.info("DailyHachimi: cards sent", { guildId, count: videos.length });
  }

  /**
   * Build the video embed card.
   * @param {Object} video - Video object from searchHachimiVideos
   * @returns {EmbedBuilder}
   */
  _buildVideoEmbed(video) {
    const durationStr = video.duration > 0 ? Formatters.formatTime(video.duration) : "未知";

    const embed = new EmbedBuilder()
      .setColor(0x00B5FF) // Bilibili blue
      .setTitle(video.title || "未知标题")
      .setDescription(`⏱️ ${durationStr}`)
      .setURL(video.url || `https://www.bilibili.com/video/${video.bvid}`);

    if (video.pic) {
      // Bilibili returns protocol-relative URLs (//i0.hdslb.com/...).
      // Discord requires a full https:// URL.
      const picUrl = video.pic.startsWith("//") ? `https:${video.pic}` : video.pic;
      embed.setImage(picUrl);
    }

    return embed;
  }

  /**
   * Build the action row with 立刻聆听 and 查看视频 buttons.
   * @param {Object} video
   * @returns {ActionRowBuilder}
   */
  _buildActionRow(video) {
    const bvid = video.bvid || "";
    const videoUrl = video.url || `https://www.bilibili.com/video/${bvid}`;

    const listenBtn = new ButtonBuilder()
      .setCustomId(`daily_play_${bvid}`)
      .setLabel("立刻聆听")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Primary);

    const linkBtn = new ButtonBuilder()
      .setLabel("查看视频")
      .setEmoji("🔗")
      .setStyle(ButtonStyle.Link)
      .setURL(videoUrl);

    return new ActionRowBuilder().addComponents(listenBtn, linkBtn);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  _loadSchedules() {
    try {
      if (fs.existsSync(this._dataFile)) {
        const raw = fs.readFileSync(this._dataFile, "utf8");
        this.schedules = JSON.parse(raw);
        logger.debug("DailyHachimi schedules loaded", {
          count: Object.keys(this.schedules).length,
        });
      }
    } catch (err) {
      logger.warn("DailyHachimi: failed to load schedules file, starting fresh", {
        file: this._dataFile,
        error: err.message,
      });
      this.schedules = {};
    }
  }

  _saveSchedules() {
    try {
      const dir = path.dirname(this._dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this._dataFile, JSON.stringify(this.schedules, null, 2), "utf8");
    } catch (err) {
      logger.error("DailyHachimi: failed to save schedules", {
        file: this._dataFile,
        error: err.message,
      });
    }
  }
}

module.exports = DailyHachimiService;
