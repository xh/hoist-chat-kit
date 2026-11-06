import type {ChatMessage} from '../message/ChatMessage';
import type {ChatHistoryMode} from '../ChatModel';
import {type ChatReplyStatus, getChatReplyStatus} from '../ChatReplyStatus';

/**
 * The thread's status for the composer - the one thing about the thread that the user should know
 * before the next send, with at most one action. See {@link getChatComposerStatus}. The desktop
 * `ChatStatusRegion` shows only those that stop a send or need the user's action.
 *
 *  - `blocked` - the host gives a reason that sending must wait.
 *  - `offline` - the browser is offline. The draft is kept, and nothing sends by itself.
 *  - `failed` - the last turn failed, or the server ended it - interrupted or cancelled.
 *  - `detached` - the last reply was left running on the server.
 *  - `stalled` - the reply in progress has had no data from the server for a while.
 *  - `waitingToRetry` - the last turn failed, and the composer waits out the time the server
 *    asked for before it retries.
 *  - `paused` - the turn waits for the user's answer to a tool call.
 *  - `busy` - a reply is in progress.
 *  - `draftRestored` - the composer restored a saved draft.
 */
export type ChatComposerStatusType =
    | 'blocked'
    | 'offline'
    | 'failed'
    | 'detached'
    | 'stalled'
    | 'waitingToRetry'
    | 'paused'
    | 'busy'
    | 'draftRestored';

/**
 * The one action a status offers.
 *
 *  - `tryAgain` - resend the turn, with the host's `retryAsync()`.
 *  - `refreshStatus` - reload the thread to learn how the run ended, with the host's
 *    `refreshStatusAsync()`.
 *  - `cancelRetry` - stop the countdown to a retry.
 *  - `discardDraft` - clear a restored draft.
 */
export type ChatComposerAction = 'tryAgain' | 'refreshStatus' | 'cancelRetry' | 'discardDraft';

/** The thread's status for the composer - see {@link getChatComposerStatus}. */
export interface ChatComposerStatus {
    type: ChatComposerStatusType;

    /** The display status of the last reply, for its icon and color. `idle` if none applies. */
    replyStatus: ChatReplyStatus;

    /** The action to offer, or null. */
    action: ChatComposerAction;

    /** Why sending is blocked, or the error that ended the reply. Null if none. */
    reason: string;

    /** For `failed`, false if a resend could run work twice - see {@link isChatRetrySafe}. */
    isRetrySafe: boolean;

    /** For `waitingToRetry`, the milliseconds left before the retry. */
    retryInMs: number;

    /** For `stalled`, how long the reply has had no data, in milliseconds. */
    stalledMs: number;

    /** For `draftRestored`, when the draft was saved, in epoch millis. */
    draftSavedAt: number;
}

/** Input to {@link getChatComposerStatus}. */
export interface ChatComposerStatusSpec {
    /** The last message of the conversation, or null. */
    lastMessage?: ChatMessage;

    /** Epoch millis of the last data from the server for the step in flight, or null. */
    lastActivityAt?: number;

    /** Milliseconds without data before a reply is stalled. Default from `ChatKit.defaults`. */
    stallAfterMs?: number;

    /** Who owns the history. Decides which failures are retry-safe. Default 'client'. */
    historyMode?: ChatHistoryMode;

    /** Why sending must wait, or null. */
    sendBlockedReason?: string;

    /** True while the browser is offline. */
    isOffline?: boolean;

    /**
     * Epoch millis at which the composer retries the failed turn, or null if it is not waiting -
     * see `ChatComposerModel.retryWaitEndsAt`.
     */
    retryWaitEndsAt?: number;

    /** True if the host can resend a turn. */
    canRetry?: boolean;

    /** True if the host can reload the thread to learn how a run ended. */
    canRefreshStatus?: boolean;

    /**
     * True while the host reloads the thread on its own, for a turn the chat does not follow. A
     * reply left running, a send blocked while the server runs the turn, and a failure that is not
     * retry-safe then offer no Refresh Status. A stalled reply still does, as its stream is open.
     */
    isStatusRefreshAutomatic?: boolean;

    /**
     * True if the host reports a turn that runs on the server while the chat does not follow it.
     * A send that the thread layer blocks for it then reads as the reply's status, or as nothing
     * while the host checks on the turn on its own.
     */
    isRunningOnServer?: boolean;

    /** When a restored draft was saved, while its notice shows, or null. */
    draftSavedAt?: number;

    /** Epoch millis to read the clock-based states at. Default now. */
    now?: number;
}

/**
 * The thread's status for the composer, or null for none. A pure function of its input, so a
 * component re-reads it as the clock ticks. It reports every status, for a layout of an app's
 * own - the desktop `ChatStatusRegion` shows a line for some of them only.
 *
 * One status shows at a time, the first that applies in this order: blocked, offline, failed or
 * detached, stalled, waiting to retry, paused, busy, and a restored draft. A reply the server
 * interrupted or cancelled counts as failed. A send that a thread layer blocks while the server
 * runs the thread's turn - see `isRunningOnServer` - offers Refresh Status, and reads as detached
 * if the last reply is. While the host checks on the turn on its own, it shows as nothing.
 *
 * A failure that is retry-safe offers Try Again. One that is not offers Refresh Status if the host
 * can refresh, else Try Again, and says the run may still be running. A retry-safe failure for
 * which the server asked for a wait counts down instead, while `retryWaitEndsAt` is set.
 */
export function getChatComposerStatus(spec: ChatComposerStatusSpec): ChatComposerStatus {
    const {
            lastMessage = null,
            historyMode = 'client',
            sendBlockedReason = null,
            isOffline = false,
            retryWaitEndsAt = null,
            canRetry = false,
            canRefreshStatus = false,
            isStatusRefreshAutomatic = false,
            isRunningOnServer = false,
            draftSavedAt = null,
            now = Date.now()
        } = spec,
        replyStatus = getChatReplyStatus({
            message: lastMessage,
            lastActivityAt: spec.lastActivityAt,
            stallAfterMs: spec.stallAfterMs,
            now
        }),
        canRefreshByHand = canRefreshStatus && !isStatusRefreshAutomatic,
        refreshMode = !canRefreshStatus
            ? 'none'
            : isStatusRefreshAutomatic
              ? 'automatic'
              : 'byHand',
        status = (type: ChatComposerStatusType, changes: Partial<ChatComposerStatus> = {}) => ({
            type,
            replyStatus,
            action: null,
            reason: null,
            isRetrySafe: true,
            retryInMs: null,
            stalledMs: null,
            draftSavedAt: null,
            ...changes
        });

    // A send blocked while the server runs the turn is no news while the host checks on the turn
    // - the reply, or the chat's placeholder for it, says so. Otherwise it offers Refresh Status,
    // or shows as the reply's status if the reply was left running.
    const isRunBlock = isRunningOnServer && sendBlockedReason === RUN_ON_SERVER_REASON;
    if (sendBlockedReason && !isRunBlock) return status('blocked', {reason: sendBlockedReason});
    if (isRunBlock && replyStatus !== 'detached' && canRefreshByHand) {
        return status('blocked', {reason: sendBlockedReason, action: 'refreshStatus'});
    }
    if (isOffline) return status('offline');

    switch (replyStatus) {
        case 'waitingToRetry':
            if (retryWaitEndsAt != null) {
                return status('waitingToRetry', {
                    action: 'cancelRetry',
                    reason: lastMessage.error,
                    retryInMs: Math.max(retryWaitEndsAt - now, 0)
                });
            }
            return failedStatus(status, lastMessage, historyMode, canRetry, refreshMode);
        case 'error':
        case 'interrupted':
        case 'cancelledByServer':
            return failedStatus(status, lastMessage, historyMode, canRetry, refreshMode);
        case 'detached':
            return status('detached', {action: canRefreshByHand ? 'refreshStatus' : null});
        case 'stalled':
            return status('stalled', {
                action: canRefreshStatus ? 'refreshStatus' : null,
                stalledMs: spec.lastActivityAt != null ? now - spec.lastActivityAt : null
            });
        case 'paused':
            return status('paused');
        case 'submitted':
        case 'streaming':
        case 'recomposing':
        case 'runningTool':
            return status('busy');
    }

    return draftSavedAt != null
        ? status('draftRestored', {action: 'discardDraft', draftSavedAt})
        : null;
}

/**
 * True if the turn that ended with this failed reply can be resent without running work twice.
 * `metadata.retrySafe` decides, if set, as by the server's `RUN_ERROR` or by an app that rebuilt
 * the reply. Otherwise a failure is retry-safe, except in server mode for the kit's own `stalled`,
 * `incomplete-stream`, `invalid-stream` and `connection-lost` errors, as the server may still be
 * running the turn.
 *
 * @param historyMode - the chat's history mode. Default 'client'.
 */
export function isChatRetrySafe(
    message: ChatMessage,
    historyMode: ChatHistoryMode = 'client'
): boolean {
    const {retrySafe, errorCode} = message?.metadata ?? {};
    if (retrySafe != null) return retrySafe === true;
    return !(historyMode === 'server' && KIT_UNSAFE_CODES.includes(errorCode));
}

/**
 * The reason `ChatThreadsModel` gives for a send it blocks while the server runs a turn that the
 * chat does not follow.
 * @internal
 */
export const RUN_ON_SERVER_REASON = 'Wait for the reply to finish.';

//------------------
// Implementation
//------------------
// Errors the kit raises when it loses sight of a run that the server may still be running.
const KIT_UNSAFE_CODES = ['stalled', 'incomplete-stream', 'invalid-stream', 'connection-lost'];

function failedStatus(
    status: (
        type: ChatComposerStatusType,
        changes?: Partial<ChatComposerStatus>
    ) => ChatComposerStatus,
    message: ChatMessage,
    historyMode: ChatHistoryMode,
    canRetry: boolean,
    refreshMode: 'none' | 'byHand' | 'automatic'
): ChatComposerStatus {
    const isRetrySafe = isChatRetrySafe(message, historyMode);
    let action: ChatComposerAction = null;
    // The host reloads a failure that is not retry-safe on its own, and a resend could run twice.
    if (!isRetrySafe && refreshMode === 'automatic') {
        action = null;
    } else if (!isRetrySafe && refreshMode === 'byHand') {
        action = 'refreshStatus';
    } else if (canRetry) {
        action = 'tryAgain';
    }
    return status('failed', {action, isRetrySafe, reason: message.error});
}
