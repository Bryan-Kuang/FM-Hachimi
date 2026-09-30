import * as logger from '../services/logger_service';

type PlaybackStage =
  | 'preparing'
  | 'extracting'
  | 'using_cached'
  | 'joining_voice'
  | 'queued'
  | 'starting_playback'
  | 'playing'
  | 'fallback_to_ytdlp'
  | 'failed';

interface PlaybackStageDetails {
  reason?: string;
  [key: string]: unknown;
}

type PlaybackStageReporter = (
  stage: PlaybackStage,
  details?: PlaybackStageDetails,
) => void | Promise<void>;

type InteractionStageReporter = PlaybackStageReporter & {
  finish(): Promise<void>;
};

interface InteractionReplyLike {
  editReply(payload: { content: string }): Promise<unknown>;
}

function emitPlaybackStage(
  reporter: PlaybackStageReporter | undefined,
  stage: PlaybackStage,
  details?: PlaybackStageDetails,
): void {
  if (!reporter) return;

  try {
    void Promise.resolve(reporter(stage, details)).catch((error: unknown) => {
      logger.debug('Playback stage reporter failed', {
        stage,
        error: (error as Error).message,
      });
    });
  } catch (error: unknown) {
    logger.debug('Playback stage reporter threw', {
      stage,
      error: (error as Error).message,
    });
  }
}

function messageForStage(stage: PlaybackStage, platformLabel: string, details?: PlaybackStageDetails): string | null {
  switch (stage) {
    case 'preparing':
      return `Preparing ${platformLabel} audio...`;
    case 'extracting':
      return `Extracting ${platformLabel} audio...`;
    case 'using_cached':
      return `Using cached ${platformLabel} audio info...`;
    case 'joining_voice':
      return 'Joining voice channel...';
    case 'queued':
      return 'Added to queue, preparing playback...';
    case 'starting_playback':
      return 'Starting playback...';
    case 'playing':
      return 'Playback started.';
    case 'fallback_to_ytdlp':
      return details?.reason
        ? `Native extraction failed, trying fallback...`
        : 'Trying fallback extraction...';
    case 'failed':
      return 'Playback failed.';
    default:
      return null;
  }
}

function createInteractionStageReporter(
  interaction: InteractionReplyLike,
  platformLabel = 'Bilibili',
): InteractionStageReporter {
  let lastContent = '';
  let closed = false;
  let pending = Promise.resolve();

  const reporter: InteractionStageReporter = ((stage, details) => {
    const content = messageForStage(stage, platformLabel, details);
    if (!content || content === lastContent || closed) return undefined;
    lastContent = content;

    pending = pending
      .then(() => undefined)
      .then(() => {
        if (closed) return undefined;
        return interaction.editReply({ content });
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        logger.debug('Failed to edit playback stage reply', {
          stage,
          error: (error as Error).message,
        });
      });

    return pending;
  }) as InteractionStageReporter;

  reporter.finish = async () => {
    closed = true;
    await pending;
  };

  return reporter;
}

export {
  createInteractionStageReporter,
  emitPlaybackStage,
  type InteractionStageReporter,
  type PlaybackStage,
  type PlaybackStageDetails,
  type PlaybackStageReporter,
};
