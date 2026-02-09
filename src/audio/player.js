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
const logger = require("../services/logger_service");
const Formatters = require("../utils/formatters");
const config = require("../config/config");

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
    this.loopMode = "queue"; // none, track, queue - 🎵 默认为queue loop
    this.currentGuild = null;
    this.startTime = null; // Track start time for progress calculation
    this.progressInterval = null; // Interval for progress updates
    this.ffmpegProcess = null; // 🔧 添加：跟踪当前FFmpeg进程
    this._ffmpegChecked = false; // Lazy FFmpeg availability check
    this._cdnRetryPending = false; // Flag for CDN failure retry coordination

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

      // 🔧 CDN故障重试：如果FFmpeg因CDN失败退出，优先重试而非跳过
      if (this._cdnRetryPending && this.currentTrack) {
        logger.info("CDN retry pending, retrying instead of skipping", {
          track: this.currentTrack?.title,
          actualPlaybackDuration,
        });
        this.retryCurrentTrack();
        return;
      }

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
   * @param {number} retryCount - Current retry attempt
   * @returns {Promise<boolean>} - Success status
   */
  async joinVoiceChannel(voiceChannel, retryCount = 0) {
    const maxRetries = 3;
    
    try {
      logger.info("Attempting to join voice channel", {
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
        guildId: voiceChannel.guild.id,
        attempt: retryCount + 1,
        maxRetries: maxRetries,
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
        attempt: retryCount + 1,
        maxRetries: maxRetries,
      });
      
      // 如果是连接超时且还有重试次数，则重试
      if (retryCount < maxRetries && 
          (error.message.includes("timeout") || 
           error.message.includes("connection"))) {
        logger.info("Retrying voice connection", {
          channelId: voiceChannel.id,
          nextAttempt: retryCount + 2,
          delay: (retryCount + 1) * 2000,
        });
        
        // 等待递增延迟后重试
        await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
        return await this.joinVoiceChannel(voiceChannel, retryCount + 1);
      }
      
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

      // 🔧 修复：增加超时时间，改进连接稳定性
      const timeout = setTimeout(() => {
        logger.error("Voice connection timeout", {
          currentStatus: this.voiceConnection?.state?.status,
          guild: this.currentGuild,
        });
        reject(new Error("Voice connection timeout"));
      }, 15000); // 增加到15秒

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
        title: this.currentTrack?.title || "Unknown",
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

      // 🔧 修复：在创建新的音频资源前先清理旧的FFmpeg进程
      // 这可以防止在queue loop模式下播放前几秒旧内容的问题
      this.cleanupFFmpegProcess();

      // Re-extract audio URL if it's stale (Bilibili CDN URLs expire)
      if (this.currentTrack.extractedAt && this.currentTrack.normalizedUrl) {
        const age = Date.now() - new Date(this.currentTrack.extractedAt).getTime();
        if (age > config.audio.urlRefreshThreshold) {
          try {
            const AudioManager = require("./manager");
            const extractor = AudioManager.getExtractor();
            if (extractor) {
              const freshUrl = await extractor.getAudioStreamUrl(this.currentTrack.normalizedUrl);
              this.currentTrack.audioUrl = freshUrl;
              this.currentTrack.extractedAt = new Date().toISOString();
              logger.info("Refreshed stale audio URL", { title: this.currentTrack.title });
            }
          } catch (e) {
            logger.warn("Failed to refresh audio URL, using cached", { error: e.message });
          }
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
        title: this.currentTrack?.title || "Unknown",
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
        title: this.currentTrack?.title || "Unknown",
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
    // Lazy FFmpeg availability check - only on first use
    if (!this._ffmpegChecked) {
      await new Promise((resolve, reject) => {
        const ffmpegCheck = spawn("ffmpeg", ["-version"]);
        ffmpegCheck.on("error", (error) => {
          logger.error("FFmpeg not available", { error: error.message });
          reject(new Error("FFmpeg is not installed. Please install FFmpeg to enable audio playback."));
        });
        ffmpegCheck.on("close", (code) => {
          if (code !== 0) {
            reject(new Error("FFmpeg check failed"));
          } else {
            resolve();
          }
        });
      });
      this._ffmpegChecked = true;
      logger.info("FFmpeg availability confirmed");
    }

    return new Promise((resolve, reject) => {
      try {
        logger.info("Creating audio resource", {
          audioUrl: audioUrl ? "Available" : "Missing",
          guild: this.currentGuild,
        });

        // 🔧 修复：改进FFmpeg参数，增加网络重试和缓冲设置
        const ffmpegProcess = spawn("ffmpeg", [
          "-user_agent",
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "-referer",
          "https://www.bilibili.com/",
          "-reconnect", "1",           // 启用重连
          "-reconnect_streamed", "1", // 对流媒体启用重连
          "-reconnect_delay_max", "5", // 最大重连延迟5秒
          "-reconnect_at_eof", "1",   // 在EOF时重连
          "-rw_timeout", "60000000",   // 读写超时60秒
          "-timeout", "60000000",     // 连接超时60秒
          "-headers", "Connection: keep-alive",
          "-analyzeduration", "10000000", // 10秒分析时间
          "-probesize", "50000000",   // 50MB探测大小
          "-fflags", "+genpts+discardcorrupt", // 生成PTS并丢弃损坏帧
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
          "warning", // 改为warning级别以获取更多调试信息
          "-bufsize", "2048k", // 增加缓冲区大小
          "pipe:1",
        ]);

        // 保存FFmpeg进程引用以便清理
        this.ffmpegProcess = ffmpegProcess;

        let stderr = "";

        // 动态监控FFmpeg进程状态，无固定超时限制
        let lastDataTime = Date.now();
        let isProcessActive = true;

        // 监控进程活跃状态 - 使用配置的阈值检测进程是否卡死
        const activityMonitor = setInterval(() => {
          const timeSinceLastData = Date.now() - lastDataTime;
          const warningThreshold = config.audio.ffmpegInactiveWarningThreshold;
          const killThreshold = config.audio.ffmpegInactiveKillThreshold;

          if (timeSinceLastData > warningThreshold && isProcessActive) {
            logger.warn("FFmpeg process appears inactive, checking status", {
              timeSinceLastData,
              warningThreshold,
              killThreshold,
              guild: this.currentGuild,
            });

            // 如果进程真的卡死了，尝试优雅关闭
            if (timeSinceLastData > killThreshold) {
              logger.error(`FFmpeg process inactive for over ${killThreshold/1000} seconds, terminating`, {
                guild: this.currentGuild,
                timeSinceLastData,
              });
              clearInterval(activityMonitor);

              if (ffmpegProcess.stdin && !ffmpegProcess.stdin.destroyed) {
                ffmpegProcess.stdin.end();
              }

              setTimeout(() => {
                if (!ffmpegProcess.killed) {
                  ffmpegProcess.kill('SIGKILL');
                }
              }, 2000);

              // Set CDN retry flag so idle handler retries instead of skipping
              this._cdnRetryPending = true;
            }
          }
        }, config.audio.ffmpegActivityCheckInterval);

        ffmpegProcess.stderr.on("data", (data) => {
          stderr += data.toString();
          lastDataTime = Date.now(); // 更新最后数据时间
        });

        ffmpegProcess.stdout.on("data", (_data) => {
          lastDataTime = Date.now(); // 更新最后数据时间 - 修复：确保stdout数据也更新活跃时间
        });

        ffmpegProcess.on("error", (error) => {
          clearInterval(activityMonitor);
          isProcessActive = false;
          logger.error("FFmpeg process error", {
            error: error.message,
            stderr: stderr.substring(0, 500),
            guild: this.currentGuild,
          });
          reject(new Error(`FFmpeg process error: ${error.message}`));
        });

        ffmpegProcess.on("close", (code) => {
          clearInterval(activityMonitor);
          isProcessActive = false;

          // 清理进程引用
          if (this.ffmpegProcess === ffmpegProcess) {
            this.ffmpegProcess = null;
          }

          if (code !== 0 && code !== null) {
            // 忽略SIGKILL和SIGTERM导致的退出码
            if (code === 137 || code === 143 || code === 15) {
              logger.info("FFmpeg process was gracefully terminated", {
                code,
                guild: this.currentGuild,
              });
              return;
            }

            // 检测CDN故障（URL过期、连接断开等），设置重试标志
            if (this.isCdnFailure(code, stderr)) {
              logger.warn("FFmpeg CDN failure detected, will retry", {
                code,
                stderr: stderr.substring(0, 500),
                guild: this.currentGuild,
                track: this.currentTrack?.title,
              });
              this._cdnRetryPending = true;
              return;
            }

            logger.error("FFmpeg process exited with error", {
              code,
              stderr: stderr.substring(0, 500),
              guild: this.currentGuild,
            });
            reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
            return;
          }
        });

        try {
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
        title: this.currentTrack?.title || "Unknown",
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

  // Removed duplicate stop() method - unified to async stop() implementation below

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
   * Remove a track from the queue by index
   * @param {number} index - Index of the track to remove
   * @returns {boolean} - Success status
   */
  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) {
      logger.warn("Invalid queue index for removal", {
        index,
        queueLength: this.queue.length,
        guild: this.currentGuild,
      });
      return false;
    }

    // Cannot remove currently playing track
    if (index === this.currentIndex) {
      logger.warn("Cannot remove currently playing track", {
        index,
        currentIndex: this.currentIndex,
        guild: this.currentGuild,
      });
      return false;
    }

    const removedTrack = this.queue[index];
    
    // Safety check for track data
    if (!removedTrack) {
      logger.warn("Track at index is undefined", {
        index,
        queueLength: this.queue.length,
        guild: this.currentGuild,
      });
      return false;
    }
    
    this.queue.splice(index, 1);

    // Adjust current index if necessary
    if (index < this.currentIndex) {
      this.currentIndex--;
    }

    logger.info("Track removed from queue", {
      removedTrack: removedTrack.title || 'Unknown Track',
      index,
      newQueueLength: this.queue.length,
      newCurrentIndex: this.currentIndex,
      guild: this.currentGuild,
    });

    return true;
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
        title: this.currentTrack?.title || "Unknown",
        guild: this.currentGuild,
      });
      await this.playCurrentTrack();
    } else {
      // Try to play next track
      logger.info("Track ended, attempting to skip to next", {
        title: this.currentTrack?.title || "Unknown",
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
   * Check if FFmpeg stderr indicates a CDN/network failure that can be retried
   */
  isCdnFailure(code, stderr) {
    if (code !== 255) return false;
    const cdnPatterns = [
      /End of file/i,
      /Server returned 4\d{2}/i,
      /Server returned 5\d{2}/i,
      /Connection reset/i,
      /Connection refused/i,
      /Connection timed out/i,
      /I\/O error/i,
      /HTTP error/i,
    ];
    return cdnPatterns.some((p) => p.test(stderr));
  }

  /**
   * Retry current track (when playback fails immediately)
   */
  async retryCurrentTrack() {
    this._cdnRetryPending = false; // Clear CDN retry flag

    if (!this.currentTrack) {
      logger.warn("No current track to retry");
      return;
    }

    logger.info("Retrying current track", {
      title: this.currentTrack?.title || "Unknown",
      attempt: (this.currentTrack.retryCount || 0) + 1,
    });

    // 限制重试次数
    this.currentTrack.retryCount = (this.currentTrack.retryCount || 0) + 1;
    if (this.currentTrack.retryCount > 2) {
      logger.error("Max retry attempts reached, skipping track", {
        title: this.currentTrack?.title || "Unknown",
      });
      this.handleTrackEnd();
      return;
    }

    // Force refresh audio URL on retry since it likely expired
    if (this.currentTrack.normalizedUrl) {
      try {
        const AudioManager = require("./manager");
        const extractor = AudioManager.getExtractor();
        if (extractor) {
          const freshUrl = await extractor.getAudioStreamUrl(this.currentTrack.normalizedUrl);
          this.currentTrack.audioUrl = freshUrl;
          this.currentTrack.extractedAt = new Date().toISOString();
          logger.info("Refreshed audio URL for retry", { title: this.currentTrack.title });
        }
      } catch (e) {
        logger.warn("Failed to refresh audio URL for retry", { error: e.message });
      }
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
      const processToCleanup = this.ffmpegProcess;
      const pidToCleanup = processToCleanup.pid;
      
      logger.info("Cleaning up FFmpeg process", {
        pid: pidToCleanup,
        guild: this.currentGuild,
      });
      
      // 立即清空引用，防止新进程被误杀
      this.ffmpegProcess = null;
      
      try {
        // 先尝试优雅地关闭stdin
        if (processToCleanup.stdin && !processToCleanup.stdin.destroyed) {
          processToCleanup.stdin.end();
        }
        
        // 然后终止进程
        processToCleanup.kill('SIGTERM');
        
        // 如果进程没有在合理时间内退出，强制杀死
        setTimeout(() => {
          if (processToCleanup && !processToCleanup.killed) {
            logger.warn("Force killing FFmpeg process", {
              pid: pidToCleanup,
            });
            processToCleanup.kill('SIGKILL');
          }
        }, 1000);
        
      } catch (error) {
        logger.warn("Error cleaning up FFmpeg process", {
          error: error.message,
          pid: pidToCleanup,
        });
      }
    }
  }
}

module.exports = AudioPlayer;
