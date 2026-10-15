import {last} from 'lodash';
import {ChatKit} from './ChatKit';
import type {ChatMessage} from './ChatMessage';
import {isToolCallFinal} from './ChatPart';

/**
 * What a reply shows as its status - one icon, one label and one color each, in the reply's
 * header and the composer's status region. A display reading of the message's
 * {@link ChatMessageStatus}, its turn's last activity and the clock - see
 * {@link getChatReplyStatus}. Never stored.
 *
 *  - `idle` - finished. No status shows.
 *  - `submitted` - the reply has started and has no answer text yet: the model is thinking,
 *    reasoning, or starting its next step after a tool.
 *  - `streaming` - answer text is arriving.
 *  - `recomposing` - the server discarded text it streamed, and the reply is being rewritten.
 *  - `runningTool` - a tool call of the reply is running.
 *  - `paused` - the turn waits for the user to answer its tool calls.
 *  - `waitingToRetry` - the turn failed, and the server asked the client to wait before it
 *    retries. Lasts while the wait runs.
 *  - `detached` - the user left the reply running on the server.
 *  - `stalled` - no data from the server, heartbeats included, for `stallAfterMs`. A soft state:
 *    the reply keeps running, and the next byte clears it.
 *  - `interrupted` - the server ended the run without deciding to, with error code `interrupted`.
 *  - `cancelledByServer` - the server cancelled the run on purpose, with error code `cancelled`.
 *  - `error` - the turn failed.
 *  - `aborted` - the user stopped the reply.
 */
export type ChatReplyStatus =
    | 'idle'
    | 'submitted'
    | 'streaming'
    | 'recomposing'
    | 'runningTool'
    | 'paused'
    | 'waitingToRetry'
    | 'detached'
    | 'stalled'
    | 'interrupted'
    | 'cancelledByServer'
    | 'error'
    | 'aborted';

/** Input to {@link getChatReplyStatus}. */
export interface ChatReplyStatusSpec {
    /** The reply. A message that is not from the assistant is always `idle`. */
    message: ChatMessage;

    /**
     * Epoch millis of the last data from the server for the reply's step in flight, or null while
     * no step is in flight - for example while a client tool runs. Read it from
     * `ChatModel.lastActivityAt` for the chat's last message. Default null: never stalled.
     */
    lastActivityAt?: number;

    /** Epoch millis to read the clock-based states at. Default now. */
    now?: number;

    /** Milliseconds without data before a reply is stalled. Default `ChatKit.defaults.stallAfterMs`. */
    stallAfterMs?: number;

    /**
     * True while the reply's text is being rewritten after the server discarded what it streamed.
     * Default false.
     */
    isRecomposing?: boolean;
}

/**
 * The display status of a reply - see {@link ChatReplyStatus}. A pure function of its input, so a
 * component re-reads it as the clock ticks.
 *
 * A reply in progress reads, in order: stalled once `stallAfterMs` passes with no data, then
 * running a tool while a call is not done, then streaming while answer text arrives, and else
 * submitted. A reply that ended reads its status, and for a failure, its `metadata.errorCode` and
 * `metadata.retryAfterSeconds`.
 */
export function getChatReplyStatus(spec: ChatReplyStatusSpec): ChatReplyStatus {
    const {message, lastActivityAt = null, now = Date.now(), isRecomposing = false} = spec,
        stallAfterMs = spec.stallAfterMs ?? ChatKit.defaults.stallAfterMs;
    if (!message?.isAssistant) return 'idle';

    const {status, metadata} = message;
    switch (status) {
        case 'complete':
            return 'idle';
        case 'paused':
            return 'paused';
        case 'aborted':
            return metadata.detached ? 'detached' : 'aborted';
        case 'error':
            return getErrorStatus(message, now);
    }

    // Pending or streaming.
    if (lastActivityAt != null && now - lastActivityAt >= stallAfterMs) return 'stalled';
    if (message.toolCalls.some(it => !isToolCallFinal(it))) return 'runningTool';
    if (isRecomposing) return 'recomposing';

    const lastPart = last(message.parts);
    if (!lastPart || lastPart.type === 'reasoning' || lastPart.type === 'toolCall') {
        return 'submitted';
    }
    return 'streaming';
}

/**
 * Milliseconds left of the wait that the server asked for before a retry, or null if the reply
 * is not waiting - see {@link ChatReplyStatus} `waitingToRetry`. The wait runs from the end of the
 * failed turn, `createdAt` plus `metadata.elapsedMs`.
 */
export function getChatRetryWaitMs(message: ChatMessage, now: number = Date.now()): number {
    const {status, metadata, createdAt} = message ?? {};
    if (status !== 'error' || !(metadata.retryAfterSeconds > 0)) return null;

    const endedAt = createdAt + (metadata.elapsedMs ?? 0),
        remaining = endedAt + metadata.retryAfterSeconds * 1000 - now;
    return remaining > 0 ? remaining : null;
}

//------------------
// Implementation
//------------------
function getErrorStatus(message: ChatMessage, now: number): ChatReplyStatus {
    switch (message.metadata.errorCode) {
        case 'interrupted':
            return 'interrupted';
        case 'cancelled':
            return 'cancelledByServer';
        default:
            return getChatRetryWaitMs(message, now) != null ? 'waitingToRetry' : 'error';
    }
}
