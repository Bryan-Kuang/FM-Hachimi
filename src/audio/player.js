/**
 * Audio Player Manager
 * Manages audio playback, queue, and voice connections
 */

const {
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  joinVoiceChannel,
  getVoiceConnection,
} = require("@discordjs/voice");
const { spawn } = require("child_process");
const logger = require("../utils/logger");
const Formatters = require("../utils/formatters");

class AudioPlayer {
  constructor() {
    this.audioPlayer = createAudioPlayer();
    this.voiceConnection = null;
    this.queue = [];
    this.currentTrack = null;
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isPaused = false;
    this.volume = 0.5;
    this.loopMode = "none"; // none, track, queue
    this.currentGuild = null;

    // Set up audio player event handlers
    this.setupAudioPlayerEvents();
  }

  /**
   * Set up audio player event handlers
   */
  setupAudioPlayerEvents() {
    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      this.isPlaying = true;
      this.isPaused = false;
      logger.info("Audio player started playing", {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
        voiceConnectionStatus: this.voiceConnection?.state?.status,
        subscribed: this.voiceConnection?.state?.subscription !== null,
      });
    });

    this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
      this.isPlaying = false;
      this.isPaused = true;
      logger.info("Audio player paused", {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      this.isPlaying = false;
      logger.info("Audio player became idle", {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });

      // Auto-advance to next track
      this.handleTrackEnd();
    });

    this.audioPlayer.on("error", (error) => {
      logger.error("Audio player error", {
        error: error.message,
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });

      // Try to recover by skipping to next track
      this.handleTrackEnd();
    });
  }

  /**
   * Join a voice channel
   * @param {VoiceChannel} voiceChannel - Discord voice channel
   * @returns {Promise<boolean>} - Success status
   */
  async joinVoiceChannel(voiceChannel) {
    try {
      logger.info("Attempting to join voice channel", {
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
        guildId: voiceChannel.guild.id,
      });

      // Check if already connected to this channel
      const existingConnection = getVoiceConnection(voiceChannel.guild.id);
      if (
        existingConnection &&
        existingConnection.joinConfig.channelId === voiceChannel.id
      ) {
        logger.info("Already connected to target voice channel");
        this.voiceConnection = existingConnection;

        // 🔧 关键修复：重新订阅音频播放器到现有连接
        logger.info("Re-subscribing audio player to existing voice connection");
        this.voiceConnection.subscribe(this.audioPlayer);

        return true;
      }

      // Create new voice connection
      this.voiceConnection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      this.currentGuild = voiceChannel.guild.id;

      // Wait for connection to be ready
      await this.waitForVoiceConnection();

      // Subscribe audio player to voice connection
      this.voiceConnection.subscribe(this.audioPlayer);

      logger.info("Successfully joined voice channel", {
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
      });

      return true;
    } catch (error) {
      logger.error("Failed to join voice channel", {
        error: error.message,
        channelId: voiceChannel?.id,
      });
      return false;
    }
  }

  /**
   * Wait for voice connection to be ready
   * @returns {Promise<void>}
   */
  async waitForVoiceConnection() {
    return new Promise((resolve, reject) => {
      if (!this.voiceConnection) {
        reject(new Error("No voice connection"));
        return;
      }

      if (this.voiceConnection.state.status === VoiceConnectionStatus.Ready) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Voice connection timeout"));
      }, 10000); // 10 second timeout

      this.voiceConnection.on(VoiceConnectionStatus.Ready, () => {
        clearTimeout(timeout);
        resolve();
      });

      this.voiceConnection.on(VoiceConnectionStatus.Disconnected, () => {
        clearTimeout(timeout);
        reject(new Error("Voice connection disconnected"));
      });
    });
  }

  /**
   * Add track to queue
   * @param {Object} trackData - Track information
   * @param {string} requestedBy - User who requested the track
   */
  addToQueue(trackData, requestedBy) {
    const track = {
      ...trackData,
      requestedBy,
      addedAt: new Date(),
      id: Date.now() + Math.random(), // Simple unique ID
    };

    this.queue.push(track);

    logger.info("Track added to queue", {
      title: track.title,
      requestedBy,
      queueLength: this.queue.length,
      guild: this.currentGuild,
    });

    return track;
  }

  /**
   * Play next track in queue
   * @returns {Promise<boolean>} - Success status
   */
  async playNext() {
    if (this.queue.length === 0) {
      logger.info("Queue is empty, stopping playback");
      this.currentTrack = null;
      this.currentIndex = -1;
      return false;
    }

    this.currentIndex = 0;
    this.currentTrack = this.queue[0];

    return await this.playCurrentTrack();
  }

  /**
   * Play specific track by index
   * @param {number} index - Track index in queue
   * @returns {Promise<boolean>} - Success status
   */
  async playTrack(index) {
    if (index < 0 || index >= this.queue.length) {
      logger.warn("Invalid track index", {
        index,
        queueLength: this.queue.length,
      });
      return false;
    }

    this.currentIndex = index;
    this.currentTrack = this.queue[index];

    return await this.playCurrentTrack();
  }

  /**
   * Play the current track
   * @returns {Promise<boolean>} - Success status
   */
  async playCurrentTrack() {
    if (!this.currentTrack) {
      logger.warn("No current track to play");
      return false;
    }

    if (!this.voiceConnection) {
      logger.warn("No voice connection available");
      return false;
    }

    try {
      logger.info("Starting to play track", {
        title: this.currentTrack.title,
        audioUrl: this.currentTrack.audioUrl ? "Available" : "Missing",
        guild: this.currentGuild,
        voiceConnectionStatus: this.voiceConnection.state.status,
      });

      // Ensure voice connection is ready
      if (this.voiceConnection.state.status !== VoiceConnectionStatus.Ready) {
        logger.warn("Voice connection not ready, waiting...", {
          status: this.voiceConnection.state.status,
        });

        try {
          await this.waitForVoiceConnection();
        } catch (connectionError) {
          throw new Error(
            `Voice connection failed: ${connectionError.message}`
          );
        }
      }

      // Create audio resource from URL
      logger.debug("Creating audio resource for playback");
      const audioResource = await this.createAudioResource(
        this.currentTrack.audioUrl
      );

      if (!audioResource) {
        throw new Error("Failed to create audio resource - resource is null");
      }

      logger.debug("Playing audio resource");
      // Play the audio
      this.audioPlayer.play(audioResource);

      // Wait a moment to see if playback starts successfully
      await new Promise((resolve) => setTimeout(resolve, 1000));

      logger.info("Track playback initiated successfully", {
        title: this.currentTrack.title,
        playerStatus: this.audioPlayer.state.status,
        voiceConnectionStatus: this.voiceConnection?.state?.status,
        subscribed: this.voiceConnection?.state?.subscription !== null,
        subscriptionPlayerId:
          this.voiceConnection?.state?.subscription?.player ===
          this.audioPlayer,
      });

      return true;
    } catch (error) {
      logger.error("Failed to play track", {
        title: this.currentTrack.title,
        error: error.message,
        stack: error.stack,
        voiceConnectionStatus: this.voiceConnection?.state?.status,
        playerStatus: this.audioPlayer.state.status,
      });

      // Don't disconnect on failure - stay in channel and report error
      throw error;
    }
  }

  /**
   * Create audio resource from URL
   * @param {string} audioUrl - Audio stream URL
   * @returns {Promise<AudioResource|null>} - Audio resource
   */
  async createAudioResource(audioUrl) {
    return new Promise((resolve, reject) => {
      try {
        logger.info("Creating audio resource", {
          audioUrl: audioUrl ? "Available" : "Missing",
          guild: this.currentGuild,
        });

        // Check if FFmpeg is available
        const { spawn } = require("child_process");
        const ffmpegCheck = spawn("ffmpeg", ["-version"]);

        ffmpegCheck.on("error", (error) => {
          logger.error("FFmpeg not available", { error: error.message });
          reject(
            new Error(
              "FFmpeg is not installed. Please install FFmpeg to enable audio playback."
            )
          );
          return;
        });

        ffmpegCheck.on("close", (code) => {
          if (code !== 0) {
            logger.error("FFmpeg check failed", { code });
            reject(new Error("FFmpeg check failed"));
            return;
          }

          // FFmpeg is available, proceed with audio resource creation
          logger.debug("FFmpeg available, creating audio stream");

          const ffmpegProcess = spawn("ffmpeg", [
            "-user_agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "-referer",
            "https://www.bilibili.com/",
            "-i",
            audioUrl,
            "-f",
            "opus",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-b:a",
            "128k",
            "-vn",
            "-loglevel",
            "error",
            "pipe:1",
          ]);

          let stderr = "";

          ffmpegProcess.stderr.on("data", (data) => {
            stderr += data.toString();
          });

          ffmpegProcess.on("error", (error) => {
            logger.error("FFmpeg process error", {
              error: error.message,
              stderr: stderr.substring(0, 500),
            });
            reject(new Error(`FFmpeg process error: ${error.message}`));
          });

          ffmpegProcess.on("close", (code) => {
            if (code !== 0) {
              logger.error("FFmpeg process exited with error", {
                code,
                stderr: stderr.substring(0, 500),
              });
              reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
              return;
            }
          });

          try {
            const audioResource = createAudioResource(ffmpegProcess.stdout, {
              inputType: StreamType.Opus,
            });

            logger.info("Audio resource created successfully");
            resolve(audioResource);
          } catch (createError) {
            logger.error("Failed to create Discord audio resource", {
              error: createError.message,
            });
            reject(
              new Error(
                `Failed to create audio resource: ${createError.message}`
              )
            );
          }
        });
      } catch (error) {
        logger.error("Failed to create audio resource", {
          error: error.message,
        });
        reject(new Error(`Audio resource creation failed: ${error.message}`));
      }
    });
  }

  /**
   * Pause playback
   * @returns {boolean} - Success status
   */
  pause() {
    if (this.audioPlayer.state.status === AudioPlayerStatus.Playing) {
      this.audioPlayer.pause();
      return true;
    }
    return false;
  }

  /**
   * Resume playback
   * @returns {boolean} - Success status
   */
  resume() {
    if (this.audioPlayer.state.status === AudioPlayerStatus.Paused) {
      this.audioPlayer.unpause();
      return true;
    }
    return false;
  }

  /**
   * Skip to next track
   * @returns {Promise<boolean>} - Success status
   */
  async skip() {
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
      this.currentTrack = this.queue[this.currentIndex];
      return await this.playCurrentTrack();
    } else if (this.loopMode === "queue" && this.queue.length > 0) {
      this.currentIndex = 0;
      this.currentTrack = this.queue[0];
      return await this.playCurrentTrack();
    }

    // No more tracks
    this.stop();
    return false;
  }

  /**
   * Go to previous track
   * @returns {Promise<boolean>} - Success status
   */
  async previous() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.currentTrack = this.queue[this.currentIndex];
      return await this.playCurrentTrack();
    } else if (this.loopMode === "queue" && this.queue.length > 0) {
      this.currentIndex = this.queue.length - 1;
      this.currentTrack = this.queue[this.currentIndex];
      return await this.playCurrentTrack();
    }

    return false;
  }

  /**
   * Stop playback and clear queue
   */
  stop() {
    this.audioPlayer.stop();
    this.currentTrack = null;
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isPaused = false;
  }

  /**
   * Clear the queue
   */
  clearQueue() {
    this.queue = [];
    if (this.currentTrack) {
      // Keep only the current track
      this.queue.push(this.currentTrack);
      this.currentIndex = 0;
    } else {
      this.currentIndex = -1;
    }

    logger.info("Queue cleared", { guild: this.currentGuild });
  }

  /**
   * Shuffle the queue
   */
  shuffleQueue() {
    if (this.queue.length <= 1) return;

    // Remove current track from shuffle
    const currentTrack = this.currentTrack;
    const remainingTracks = this.queue.filter(
      (_, index) => index !== this.currentIndex
    );

    // Shuffle remaining tracks
    for (let i = remainingTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainingTracks[i], remainingTracks[j]] = [
        remainingTracks[j],
        remainingTracks[i],
      ];
    }

    // Rebuild queue with current track first
    if (currentTrack) {
      this.queue = [currentTrack, ...remainingTracks];
      this.currentIndex = 0;
    } else {
      this.queue = remainingTracks;
      this.currentIndex = -1;
    }

    logger.info("Queue shuffled", {
      queueLength: this.queue.length,
      guild: this.currentGuild,
    });
  }

  /**
   * Set loop mode
   * @param {string} mode - Loop mode: "none", "track", "queue"
   */
  setLoopMode(mode) {
    if (["none", "track", "queue"].includes(mode)) {
      this.loopMode = mode;
      logger.info("Loop mode changed", { mode, guild: this.currentGuild });
    }
  }

  /**
   * Handle track end
   */
  async handleTrackEnd() {
    if (this.loopMode === "track" && this.currentTrack) {
      // Repeat current track
      await this.playCurrentTrack();
    } else {
      // Try to play next track
      await this.skip();
    }
  }

  /**
   * Get current player state
   * @returns {Object} - Player state
   */
  getState() {
    return {
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      currentTrack: this.currentTrack,
      currentIndex: this.currentIndex,
      queue: this.queue,
      queueLength: this.queue.length,
      hasNext: this.currentIndex < this.queue.length - 1,
      hasPrevious: this.currentIndex > 0,
      loopMode: this.loopMode,
      volume: this.volume,
      connected: !!this.voiceConnection,
    };
  }

  /**
   * Leave voice channel
   */
  leaveVoiceChannel() {
    if (this.voiceConnection) {
      this.voiceConnection.destroy();
      this.voiceConnection = null;
      this.currentGuild = null;
      this.stop();

      logger.info("Left voice channel");
    }
  }

  /**
   * Get queue with formatted information
   * @returns {Array} - Formatted queue
   */
  getFormattedQueue() {
    return this.queue.map((track, index) => ({
      ...track,
      position: index + 1,
      isCurrentlyPlaying: index === this.currentIndex,
      duration: Formatters.formatTime(track.duration),
      addedAt: Formatters.formatTime(Date.now() - track.addedAt.getTime()),
    }));
  }
}

module.exports = AudioPlayer;
