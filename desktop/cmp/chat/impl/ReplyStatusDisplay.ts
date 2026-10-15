import type {ReactElement} from 'react';
import {Icon} from '@xh/hoist/icon';
import type {ChatReplyStatus} from '../../../../core';
import {formatStallDuration} from './ChatFormat';

/**
 * Color of a status, by what it asks of the user.
 *
 *  - `busy` - the reply is working.
 *  - `attention` - the reply waits for the user.
 *  - `warning` - the reply may not finish as asked, through no choice of the user's.
 *  - `error` - the reply failed.
 *  - `meta` - a state the user cannot speed up, or chose.
 *
 * @internal
 */
export type ReplyStatusIntent = 'busy' | 'attention' | 'warning' | 'error' | 'meta';

/** @internal */
export interface ReplyStatusDisplay {
    /** The status icon - a function returning one, `spinner` for the chat spinner, or null. */
    icon: (() => ReactElement) | 'spinner';

    /** The status words, or null for `idle`, which shows none. */
    label: string;

    intent: ReplyStatusIntent;
}

/**
 * The one icon, label and color of each reply status. Every component that shows a reply's
 * status reads it here, so that a status looks the same wherever it shows.
 * @internal
 */
export const REPLY_STATUS_DISPLAY: Readonly<Record<ChatReplyStatus, ReplyStatusDisplay>> = {
    idle: {icon: null, label: null, intent: 'meta'},
    submitted: {icon: 'spinner', label: 'Thinking', intent: 'busy'},
    streaming: {icon: 'spinner', label: 'Writing', intent: 'busy'},
    recomposing: {icon: 'spinner', label: 'Revising', intent: 'busy'},
    runningTool: {icon: 'spinner', label: 'Running tools', intent: 'busy'},
    paused: {icon: () => Icon.pauseCircle(), label: 'Waiting for you', intent: 'attention'},
    // The clock, not the hourglass: the hourglass means busy under reduced motion.
    waitingToRetry: {icon: () => Icon.clock(), label: 'Waiting to retry', intent: 'meta'},
    // A reply left running on the server. Hoist registers no code-branch icon - see the README.
    detached: {icon: () => Icon.server(), label: 'Still working', intent: 'meta'},
    stalled: {icon: () => Icon.warning(), label: 'No response', intent: 'warning'},
    interrupted: {icon: () => Icon.warningCircle(), label: 'Interrupted', intent: 'warning'},
    cancelledByServer: {
        icon: () => Icon.slashedCircle(),
        label: 'Cancelled by the server',
        intent: 'warning'
    },
    error: {icon: () => Icon.error(), label: 'The reply failed.', intent: 'error'},
    aborted: {icon: () => Icon.stopCircle(), label: 'Stopped', intent: 'meta'}
};

/**
 * True for a status whose icon moves - one that shows a spinner.
 * @internal
 */
export function isMovingStatus(status: ChatReplyStatus): boolean {
    return REPLY_STATUS_DISPLAY[status].icon === 'spinner';
}

/**
 * The words of a status. A stalled reply says how long it has had no data, as
 * "No response for 34s".
 * @internal
 */
export function getReplyStatusLabel(status: ChatReplyStatus, stalledMs: number = null): string {
    const {label} = REPLY_STATUS_DISPLAY[status];
    return status === 'stalled' && stalledMs != null
        ? `${label} for ${formatStallDuration(stalledMs)}`
        : label;
}
