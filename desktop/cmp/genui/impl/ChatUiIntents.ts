import type {Intent} from '@xh/hoist/core';
import type {ChatUiIntent} from '../Types';

/** The intents a model may write, for the `enum` of a props schema. */
export const CHAT_UI_INTENTS: ChatUiIntent[] = ['none', 'primary', 'success', 'warning', 'danger'];

/**
 * The Hoist intent for one the model wrote. `none` is no intent. A value that is not an intent,
 * such as one cut short as it streams, or no value, is `fallback`.
 */
export function toHoistIntent(intent: ChatUiIntent, fallback: Intent = null): Intent {
    if (intent === 'none') return null;
    return CHAT_UI_INTENTS.includes(intent) ? (intent as Intent) : fallback;
}
