import type {PlainObject} from '@xh/hoist/core';
import {isEmpty, isFinite, keyBy, last, max, min, omit, sumBy} from 'lodash';
import type {ChatDecoder, ChatEvent} from '../transport';
import {ChatMessage, type ChatMessageSpec} from './ChatMessage';
import type {ChatInterrupt} from './ChatInterrupt';
import type {ChatTextTransform} from './ChatModel';
import {ChatRunError} from './ChatRunError';
import {ChatStreamReducer} from './ChatStreamReducer';
import {SETTLE_REASONS, settleOpenParts, settleStreamingParts} from './impl/messageUtils';

/** Options for {@link replayChatEvents}. */
export interface ChatReplayOptions {
    /**
     * Decodes each stored record into events, as for a live stream. With `AgUiCodec`, pass
     * `codec.createDecoder()`, so that stored events pass the same AG-UI checks as live ones. A
     * decoder holds the state of one stream, so give each call a new one. Default none: the
     * records are kit events already.
     */
    decoder?: ChatDecoder;

    /** Id of the reply. Default a new id. */
    id?: string;

    /**
     * How the turn ended, if the backend records it apart from the events - such as a turn the
     * user stopped, which a backend may store as a `RUN_ERROR`. A reply given a status is never
     * detached. Default from the events: see {@link replayChatEvents}.
     */
    status?: 'complete' | 'error' | 'aborted';

    /** Error message for a reply with status `error`. Default the message of its `RUN_ERROR`. */
    error?: string;

    /**
     * App data for the reply's `metadata`, such as the server's id for it. Keys the events set,
     * such as `finishReason`, win. For a reply that shows catalog UI, include the `catalogVersion`
     * it was written for, if the backend kept it, so that its UI can migrate.
     */
    metadata?: PlainObject;

    /** Rewrites model text before it is stored. Pass the chat's `ChatModelConfig.textTransform`. */
    textTransform?: ChatTextTransform;
}

/**
 * Rebuild an assistant reply from the events a backend stored for its turn, for a thread's
 * history - such as from a `ChatThreadStore.loadMessagesAsync`. The events pass through the same
 * reducer as a live stream, a new one for each run after a finished one, as live. So the reply
 * holds what it held live: its steps, tool calls, sub-agents, activity and sources, with the parts
 * of superseded attempts dropped.
 *
 * The reply is timed by the events' `timestamp`s, not by the time of the load. It starts at its
 * first event, each part starts and ends at the events that open and close it, and its
 * `elapsedMs` sums the time its runs took. An event with no `timestamp` takes the one before it.
 * A reply whose events have none takes the time of the load and records no `elapsedMs`.
 *
 * Its status follows from how the events end, unless `opts.status` says otherwise:
 *
 *  - `RUN_FINISHED` - `complete`, or `paused` if the run ended on interrupts for the user.
 *  - `RUN_ERROR` - `error`, with the event's message and code.
 *  - neither - `aborted` and `metadata.detached`, for a turn still running on the server. The
 *    chat then offers to refresh its status, as after the user left a live reply running.
 *
 * Anything a turn leaves open, such as a tool call with no result, is closed as the live chat
 * would close it, at the time of the turn's last event. An interrupt that a later run answered
 * counts as delivered. The user's answers to it are not among the events.
 *
 * A record that the decoder rejects fails the reply, as it would fail a live stream, with the
 * content before it and the decoder's error. Other replies of the thread are not affected.
 *
 * Neither the user's message nor the results of tools run in the browser are among AG-UI events.
 * Build the user's message from the backend's own record of it.
 *
 * @param records - the turn's stored events, in the order they streamed. With `opts.decoder`, the
 *      raw records it decodes.
 */
export function replayChatEvents(
    records: PlainObject[],
    opts: ChatReplayOptions = {}
): ChatMessageSpec {
    const {id, error, metadata, textTransform} = opts,
        {events, decodeError} = decodeAll(records, opts.decoder),
        runs = splitRuns(stampAll(events)),
        lastIdx = runs.length - 1;

    // One reducer for each run, as live: a run after a finished one is the next step of the turn.
    let message = new ChatMessage({id, role: 'assistant', status: 'pending', metadata}),
        reducer: ChatStreamReducer = null;
    runs.forEach((run, idx) => {
        reducer = new ChatStreamReducer(idx, {textTransform, useEventTimestamps: true});
        message = reducer.apply(message, run);
        if (idx < lastIdx) message = reducer.finish(message);
    });

    // A run that ends in error, or with no end, closes as a live turn does - not by `finish`,
    // which would fail what a stop leaves running.
    const isEnded = reducer.isRunFinished || message.status === 'error',
        isStopped = decodeError != null || opts.status === 'aborted' || !isEnded;
    message = isStopped ? reducer.settleText(message) : reducer.finish(message);

    const status = decodeError ? 'error' : (opts.status ?? endStatus(message, reducer, isEnded)),
        times = runs.map(runTimes).filter(it => it != null),
        endedAt = max(times.map(it => it[1])) ?? null,
        settleAt = endedAt ?? Date.now(),
        settled =
            status === 'paused'
                ? settleStreamingParts(settleEarlierCalls(message, lastIdx, settleAt), settleAt)
                : settleOpenParts(message, SETTLE_REASONS[status], status === 'aborted', settleAt);

    // A failure's details go with the failure, as for a stopped turn that a backend stored as one.
    let replyMetadata: PlainObject =
        status === 'error' ? settled.metadata : omit(settled.metadata, ERROR_KEYS);
    if (decodeError) {
        replyMetadata = {...replyMetadata, errorCode: decodeError.code ?? 'invalid-stream'};
    }
    // The time the runs took. Waits between them, such as for the user's answers, do not count.
    if (!isEmpty(times)) {
        const elapsedMs = sumBy(times, ([start, end]) => end - start);
        replyMetadata = {...replyMetadata, elapsedMs, ...(status === 'paused' ? {} : {endedAt})};
    }
    if (!isEnded && opts.status == null && !decodeError) {
        replyMetadata = {...replyMetadata, detached: true};
    }
    // The server took each answer that a later run carried.
    if (replyMetadata.interrupts) {
        replyMetadata = {
            ...replyMetadata,
            interrupts: replyMetadata.interrupts.map((it: ChatInterrupt) =>
                it.step < lastIdx ? {...it, delivered: true} : it
            )
        };
    }

    return settled
        .withChanges({
            status,
            error:
                status === 'error'
                    ? (decodeError?.message ?? error ?? settled.error ?? 'Unknown error.')
                    : null,
            metadata: replyMetadata,
            ...(isEmpty(times) ? {} : {createdAt: min(times.map(it => it[0]))})
        })
        .toSpec();
}

//------------------
// Implementation
//------------------
const ERROR_KEYS = ['errorCode', 'retryAfterSeconds', 'retrySafe'];

/**
 * The records' events, through the decoder if given. A record the decoder rejects ends the
 * events there, with its error, as it would end a live stream.
 */
function decodeAll(
    records: PlainObject[],
    decoder: ChatDecoder
): {events: ChatEvent[]; decodeError: ChatRunError} {
    if (!decoder) return {events: records as ChatEvent[], decodeError: null};

    const events: ChatEvent[] = [];
    try {
        records.forEach(it => events.push(...decoder(it)));
        events.push(...(decoder.flush?.() ?? []));
        return {events, decodeError: null};
    } catch (e) {
        const decodeError =
            e instanceof ChatRunError
                ? e
                : new ChatRunError(e?.message ?? String(e), 'invalid-stream');
        return {events, decodeError};
    }
}

/**
 * The events with a time on each: an event with no `timestamp` takes the one before it, and
 * those before the first take the first, so that no part is timed by the load.
 */
function stampAll(events: ChatEvent[]): ChatEvent[] {
    let time: number = events.find(it => isFinite(it.timestamp))?.timestamp ?? null;
    if (time == null) return events;
    return events.map(it => {
        if (isFinite(it.timestamp)) {
            time = it.timestamp;
            return it;
        }
        return {...it, timestamp: time};
    });
}

/** The events split into runs: a `RUN_STARTED` after a `RUN_FINISHED` starts the next. */
function splitRuns(events: ChatEvent[]): ChatEvent[][] {
    const ret: ChatEvent[][] = [[]];
    let isFinished = false;
    events.forEach(event => {
        if (event.type === 'RUN_STARTED' && isFinished) {
            ret.push([]);
            isFinished = false;
        }
        if (event.type === 'RUN_FINISHED') isFinished = true;
        last(ret).push(event);
    });
    return ret;
}

/**
 * A paused reply with the tool calls of its earlier steps closed. A call the browser ran has its
 * result in the next step's request, not among the events, so it would otherwise wait on the user
 * again. Other parts stay as they are, such as a sub-agent that waits on the reply's interrupts.
 */
function settleEarlierCalls(message: ChatMessage, step: number, endedAt: number): ChatMessage {
    const calls = message.toolCalls.filter(it => it.step < step),
        earlier = message.withChanges({parts: calls}),
        settled = keyBy(
            settleOpenParts(earlier, SETTLE_REASONS.complete, false, endedAt).parts,
            'id'
        );
    return message.withChanges({parts: message.parts.map(it => settled[it.id] ?? it)});
}

/** The first and last time of a run's events, or null if none has a time. */
function runTimes(run: ChatEvent[]): [number, number] {
    const times = run.map(it => it.timestamp).filter(it => isFinite(it));
    return isEmpty(times) ? null : [min(times), max(times)];
}

function endStatus(
    message: ChatMessage,
    reducer: ChatStreamReducer,
    isEnded: boolean
): 'complete' | 'error' | 'aborted' | 'paused' {
    if (!isEnded) return 'aborted';
    if (message.status === 'error') return 'error';
    return reducer.outcome?.type === 'interrupt' ? 'paused' : 'complete';
}
