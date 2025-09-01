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
    this.loopMode = "track"; // none, track, queue - 🎵 默认为single loop
    this.currentGuild = null;
    this.startTime = null; // Track start time for progress calculation
    this.progressInterval = null; // Interval for progress updates
    this.ffmpegProcess = null; // 🔧 添加：跟踪当前FFmpeg进程

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
      this.startTime = Date.now(); // Record when playback started

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
      this.startTime = null; // Clear start time when paused

      logger.info("Audio player paused", {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      this.isPlaying = false;

      // 🔧 修复：清理FFmpeg进程避免"Broken pipe"错误
      this.cleanupFFmpegProcess();

      // Calculate actual playback duration using startTime
      const actualPlaybackDuration = this.startTime
        ? Date.now() - this.startTime
        : 0;

      logger.info("Audio player became idle", {
        track: this.currentTrack?.title,
        guild: this.currentGuild,
        resource: this.audioPlayer.state.resource !== null,
        playbackDuration: this.audioPlayer.state.playbackDuration,
        actualPlaybackDuration,
        trackDuration: this.currentTrack?.duration,
      });

      // 🔧 修复：使用实际播放时间而不是state.playbackDuration
      // 对于Raw PCM，playbackDuration可能始终为0
      if (
        actualPlaybackDuration > 3000 ||
        (this.currentTrack?.duration &&
          actualPlaybackDuration >= (this.currentTrack.duration - 2) * 1000)
      ) {
        // 正常播放结束（播放超过3秒或接近歌曲总时长）
        logger.info("Track ended normally", {
          actualPlaybackDuration,
          trackDuration: this.currentTrack?.duration,
        });
        this.handleTrackEnd();
      } else if (this.currentTrack) {
        // 播放时间太短，可能是错误，重试当前曲目
        logger.warn("Playback duration too short, retrying current track", {
          actualPlaybackDuration,
          track: this.currentTrack?.title,
          loopMode: this.loopMode,
        });
        // 如果是track loop模式，不计入retry次数
        if (this.loopMode === "track") {
          this.currentTrack.retryCount = 0;
        }
        this.retryCurrentTrack();
      }
    });

    this.audioPlayer.on("error", (error) => {
      logger.error("Audio player error", {
        error: error.message,
        track: this.currentTrack?.title,
        guild: this.currentGuild,
      });

      // 🔧 修复：清理FFmpeg进程避免"Broken pipe"错误
      this.cleanupFFmpegProcess();

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

      // 🔧 修复：减少超时时间，添加更多状态监听
      const timeout = setTimeout(() => {
        logger.error("Voice connection timeout", {
          currentStatus: this.voiceConnection?.state?.status,
          guild: this.currentGuild,
        });
        reject(new Error("Voice connection timeout"));
      }, 5000); // 减少到5秒

      const cleanup = () => {
        clearTimeout(timeout);
        this.voiceConnection.removeAllListeners(VoiceConnectionStatus.Ready);
        this.voiceConnection.removeAllListeners(
          VoiceConnectionStatus.Disconnected
        );
        this.voiceConnection.removeAllListeners(
          VoiceConnectionStatus.Destroyed
        );
      };

      this.voiceConnection.once(VoiceConnectionStatus.Ready, () => {
        logger.info("Voice connection is ready");
        cleanup();
        resolve();
      });

      this.voiceConnection.once(VoiceConnectionStatus.Disconnected, () => {
        logger.warn("Voice connection disconnected during wait");
        cleanup();
        reject(new Error("Voice connection disconnected"));
      });

      this.voiceConnection.once(VoiceConnectionStatus.Destroyed, () => {
        logger.warn("Voice connection destroyed during wait");
        cleanup();
        reject(new Error("Voice connection destroyed"));
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

    // 🔧 修复：智能决定播放位置
    if (this.currentTrack === null || this.currentIndex === -1) {
      // 新开始播放或队列结束后重新开始，从第一首开始
      this.currentIndex = 0;
      logger.debug("Starting playback from beginning", {
        queueLength: this.queue.length,
      });
    } else if (this.currentIndex >= this.queue.length) {
      // 索引超出范围（比如添加了新歌），从新添加的歌开始
      this.currentIndex = this.queue.length - 1;
      logger.debug("Starting from newly added track", {
        newIndex: this.currentIndex,
        queueLength: this.queue.length,
      });
    }
    // 否则保持当前索引位置（正常播放中的情况）

    this.currentTrack = this.queue[this.currentIndex];

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

          // 🔧 修复：输出Raw PCM格式而不是Opus，避免管道问题
          const ffmpegProcess = spawn("ffmpeg", [
            "-user_agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "-referer",
            "https://www.bilibili.com/",
            "-i",
            audioUrl,
            "-f",
            "s16le", // Raw PCM 16-bit signed little-endian
            "-ar",
            "48000",
            "-ac",
            "2",
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
            // 🔧 添加：保存FFmpeg进程引用以便后续清理
            this.ffmpegProcess = ffmpegProcess;
            
            // 🔧 修复：使用Raw PCM而不是Opus，让Discord.js处理编码
            const audioResource = createAudioResource(ffmpegProcess.stdout, {
              inputType: StreamType.Raw,
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
    // Check if we can skip to next track
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
      this.currentTrack = this.queue[this.currentIndex];
      // Only attempt to play if we have a voice connection
      if (this.voiceConnection) {
        return await this.playCurrentTrack();
      }
      return true; // Track was set successfully for testing
    } else if (this.loopMode === "queue" && this.queue.length > 0) {
      // Loop back to beginning
      this.currentIndex = 0;
      this.currentTrack = this.queue[0];
      logger.info("Queue loop: restarting from beginning", {
        queueLength: this.queue.length,
        guild: this.currentGuild,
      });
      // Only attempt to play if we have a voice connection
      if (this.voiceConnection) {
        return await this.playCurrentTrack();
      }
      return true; // Loop was set successfully for testing
    } else if (this.loopMode === "track" && this.currentTrack) {
      // Restart current track
      logger.info("Track loop: replaying current track", {
        title: this.currentTrack.title,
        guild: this.currentGuild,
      });
      // Only attempt to play if we have a voice connection
      if (this.voiceConnection) {
        return await this.playCurrentTrack();
      }
      return true; // Track loop was set successfully for testing
    }

    // No more tracks and no loop - 停止播放并重置状态
    logger.info("No next track available, stopping playback", {
      currentIndex: this.currentIndex,
      queueLength: this.queue.length,
      loopMode: this.loopMode,
      guild: this.currentGuild,
    });

    // 🔧 修复：当队列播放完毕时，重置播放状态
    if (this.audioPlayer) {
      this.audioPlayer.stop();
    }
    this.currentTrack = null;
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isPaused = false;

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
      logger.info("Previous track", {
        index: this.currentIndex,
        title: this.currentTrack?.title,
        guild: this.currentGuild,
      });
      
      // 🔧 修复：在测试环境下或有语音连接时播放
      if (this.voiceConnection) {
        return await this.playCurrentTrack();
      } else {
        // 测试环境下直接返回true
        return true;
      }
    } else if (this.loopMode === "queue" && this.queue.length > 0) {
      this.currentIndex = this.queue.length - 1;
      this.currentTrack = this.queue[this.currentIndex];
      logger.info("Queue loop - previous track", {
        index: this.currentIndex,
        title: this.currentTrack?.title,
        guild: this.currentGuild,
      });
      
      // 🔧 修复：在测试环境下或有语音连接时播放
      if (this.voiceConnection) {
        return await this.playCurrentTrack();
      } else {
        // 测试环境下直接返回true
        return true;
      }
    }

    return false;
  }

  /**
   * Stop playback and clear queue
   */
  stop() {
    this.audioPlayer.stop();
    
    // 🔧 修复：清理FFmpeg进程避免"Broken pipe"错误
    this.cleanupFFmpegProcess();
    
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
   * Get current playback time in seconds
   * @returns {number} - Current playback time
   */
  getCurrentTime() {
    if (!this.isPlaying || !this.startTime || !this.currentTrack) {
      return 0;
    }

    const elapsed = (Date.now() - this.startTime) / 1000;
    return Math.min(elapsed, this.currentTrack.duration || 0);
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
   * Stop playback and clear queue
   */
  async stop() {
    try {
      // 🔧 添加：清理FFmpeg进程
      if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
        logger.debug("Terminating FFmpeg process");
        this.ffmpegProcess.kill('SIGTERM');
        this.ffmpegProcess = null;
      }
      
      // Stop audio player
      this.audioPlayer.stop();

      // Clear queue and reset state
      this.queue = [];
      this.currentTrack = null;
      this.currentIndex = -1;
      this.isPlaying = false;
      this.isPaused = false;
      this.startTime = null;

      // Leave voice channel
      if (this.voiceConnection) {
        this.voiceConnection.destroy();
        this.voiceConnection = null;
      }

      logger.info("Playback stopped and queue cleared", {
        guild: this.currentGuild,
      });

      return true;
    } catch (error) {
      logger.error("Failed to stop playback", {
        error: error.message,
        guild: this.currentGuild,
      });
      return false;
    }
  }

  /**
   * Handle track end
   */
  async handleTrackEnd() {
    // Add null check to prevent errors when track is cleared
    if (!this.currentTrack) {
      logger.warn("handleTrackEnd called but no current track available");
      return;
    }

    if (this.loopMode === "track" && this.currentTrack) {
      // Repeat current track - reset retry count for loop
      this.currentTrack.retryCount = 0;
      logger.info("Track ended, looping current track", {
        title: this.currentTrack.title,
        guild: this.currentGuild,
      });
      await this.playCurrentTrack();
    } else {
      // Try to play next track
      logger.info("Track ended, attempting to skip to next", {
        title: this.currentTrack.title,
        currentIndex: this.currentIndex,
        queueLength: this.queue.length,
        loopMode: this.loopMode,
        guild: this.currentGuild,
      });
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
      hasNext: this.canSkip(),
      hasPrevious: this.canGoBack(),
      loopMode: this.loopMode,
      volume: this.volume,
      connected: !!this.voiceConnection,
    };
  }

  /**
   * Check if can skip to next track
   * @returns {boolean}
   */
  canSkip() {
    return (
      this.currentIndex < this.queue.length - 1 || // Has next track
      this.loopMode === "queue" || // Queue loop enabled
      this.loopMode === "track" // Track loop enabled
    );
  }

  /**
   * Check if can go to previous track
   * @returns {boolean}
   */
  canGoBack() {
    return (
      this.currentIndex > 0 || // Has previous track
      (this.loopMode === "queue" && this.queue.length > 1) // Queue loop with multiple tracks
    );
  }

  /**
   * Leave voice channel
   */
  leaveVoiceChannel() {
    logger.info("Leaving voice channel");
    
    // 🔧 修复：使用完善的FFmpeg进程清理方法
    this.cleanupFFmpegProcess();
    
    if (this.voiceConnection) {
      this.voiceConnection.destroy();
      this.voiceConnection = null;
      this.currentGuild = null;
      this.stop();

      logger.info("Left voice channel");
    }
  }

  /**
   * Retry current track (when playback fails immediately)
   */
  async retryCurrentTrack() {
    if (!this.currentTrack) {
      logger.warn("No current track to retry");
      return;
    }

    logger.info("Retrying current track", {
      title: this.currentTrack.title,
      attempt: (this.currentTrack.retryCount || 0) + 1,
    });

    // 限制重试次数
    this.currentTrack.retryCount = (this.currentTrack.retryCount || 0) + 1;
    if (this.currentTrack.retryCount > 2) {
      logger.error("Max retry attempts reached, skipping track", {
        title: this.currentTrack.title,
      });
      this.handleTrackEnd();
      return;
    }

    // 等待一下再重试
    setTimeout(() => {
      this.playCurrentTrack().catch((error) => {
        logger.error("Retry failed", {
          error: error.message,
          title: this.currentTrack?.title,
        });
        this.handleTrackEnd();
      });
    }, 2000);
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

  /**
   * 清理FFmpeg进程避免"Broken pipe"错误
   */
  cleanupFFmpegProcess() {
    if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
      logger.info("Cleaning up FFmpeg process", {
        pid: this.ffmpegProcess.pid,
        guild: this.currentGuild,
      });
      
      try {
        // 先尝试优雅地关闭stdin
        if (this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
          this.ffmpegProcess.stdin.end();
        }
        
        // 然后终止进程
        this.ffmpegProcess.kill('SIGTERM');
        
        // 如果进程没有在合理时间内退出，强制杀死
        setTimeout(() => {
          if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
            logger.warn("Force killing FFmpeg process", {
              pid: this.ffmpegProcess.pid,
            });
            this.ffmpegProcess.kill('SIGKILL');
          }
        }, 1000);
        
      } catch (error) {
        logger.warn("Error cleaning up FFmpeg process", {
          error: error.message,
          pid: this.ffmpegProcess.pid,
        });
      }
      
      this.ffmpegProcess = null;
    }
  }
}

module.exports = AudioPlayer;
