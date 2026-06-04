export const RADIO_ONLY_STOP_MESSAGE = 'Only Stop and Skip are available in radio mode.';
export const RADIO_ONLY_STOP_SUGGESTION = 'Use Stop to end radio mode, or Skip to jump to the next radio video.';

const blockedRadioButtonIds = new Set([
  'pause_resume',
  'prev',
  'loop',
  'queue',
  'queue_clear',
  'queue_shuffle',
  'queue_loop',
  'queue_remove',
  'queue_prev_page',
  'queue_next_page',
  'volume_down',
  'mute_toggle',
  'volume_up',
  'volume_display',
]);

const blockedRadioSelectIds = new Set([
  'loop_select',
  'queue_remove_select',
]);

export function isRadioBlockedButton(customId: string): boolean {
  return customId !== 'stop' && (
    blockedRadioButtonIds.has(customId) ||
    customId.startsWith('queue_delete_')
  );
}

export function isRadioBlockedSelect(customId: string): boolean {
  return blockedRadioSelectIds.has(customId);
}
