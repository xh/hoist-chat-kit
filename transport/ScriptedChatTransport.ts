import type {Awaitable, PlainObject} from '@xh/hoist/core';
import {throwIf} from '@xh/hoist/utils/js';
import {flattenDeep, isArray, isString} from 'lodash';
import {sleepAsync} from '../core/impl/abort';
import {genChatId} from '../core/impl/ids';
import type {ChatEvent} from './ChatEvent';
import type {ChatRunRequest, ChatTransport} from './ChatTransport';

/** Configuration for a {@link ScriptedChatTransport}. */
export interface ScriptedChatTransportConfig {
    /**
     * Response to each request - each step - in order, across all turns. A request beyond the end
     * of the list fails. Provide either this or `respond`.
     */
    responses?: ScriptedResponse[];

    /**
     * Build the response to a request - for scripts that react to the user's message or to tool
     * results in the request.
     *
     * @param request - the request for the step.
     * @param requestIndex - zero-based count of the requests this transport has received.
     */
    respond?: (request: ChatRunRequest, requestIndex: number) => Awaitable<ScriptedResponse>;

    /** Pause before each scripted event, in milliseconds. Default 25. Use 0 in tests. */
    delayMs?: number;
}

/**
 * The scripted response to one step. Either a list of events and pauses, which may nest
 * (as returned by the helpers in this module) and are paced by the transport, or an async
 * iterable of events, which sets its own pace.
 */
export type ScriptedResponse = ScriptedItem[] | AsyncIterable<ChatEvent>;

/** An event, a pause, or a nested list of either. */
export type ScriptedItem = ChatEvent | ScriptedDelay | ScriptedItem[];

/** A pause in a scripted response - see {@link scriptedDelay}. */
export interface ScriptedDelay {
    delayMs: number;
}

/**
 * Transport that plays back scripted events, for unit tests, demos, and offline development. It
 * needs no backend and no model.
 *
 * Each step takes the next of the scripted `responses`, or the result of `respond`. The
 * transport adds `RUN_STARTED` and `RUN_FINISHED` events where a response leaves them out, and
 * waits `delayMs` before each event for a realistic stream. Build responses with the helpers in
 * this module, which produce well-formed AG-UI event sequences:
 *
 * ```ts
 * const transport = new ScriptedChatTransport({
 *     responses: [
 *         // Step 1 - think, then call a client tool.
 *         [
 *             reasoningEvents('The user wants the weather in Paris. I will look it up.'),
 *             toolCallEvents('getWeather', {city: 'Paris'})
 *         ],
 *         // Step 2 - after the tool result is sent back, answer.
 *         [scriptedDelay(400), textEvents('It is **18°C** and sunny in Paris.')]
 *     ]
 * });
 * ```
 *
 * The transport stops promptly, with an abort error, when the request's signal aborts.
 */
export class ScriptedChatTransport implements ChatTransport {
    /** Pause before each scripted event, in milliseconds. */
    readonly delayMs: number;

    /**
     * Requests received, oldest first - for tests to inspect what the chat sent. Each request
     * holds the history it carried, so the list grows with every step the transport runs.
     */
    readonly requests: ChatRunRequest[] = [];

    constructor({responses = [], respond = null, delayMs = 25}: ScriptedChatTransportConfig = {}) {
        this.responses = responses;
        this.respond = respond;
        this.delayMs = delayMs;
    }

    async *run(request: ChatRunRequest): AsyncGenerator<ChatEvent> {
        const {threadId, runId, signal} = request,
            requestIndex = this.requests.length;
        this.requests.push(request);

        const response = await this.getResponseAsync(request, requestIndex);
        let isStarted = false;
        for await (const event of this.playAsync(response, signal)) {
            if (!isStarted && event.type !== 'RUN_STARTED') {
                yield {type: 'RUN_STARTED', threadId, runId};
            }
            isStarted = true;
            yield event;
            if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') return;
        }

        if (!isStarted) yield {type: 'RUN_STARTED', threadId, runId};
        yield {type: 'RUN_FINISHED', threadId, runId};
    }

    //------------------
    // Implementation
    //------------------
    private readonly responses: ScriptedResponse[];
    private readonly respond: ScriptedChatTransportConfig['respond'];

    private async getResponseAsync(
        request: ChatRunRequest,
        requestIndex: number
    ): Promise<ScriptedResponse> {
        if (this.respond) return this.respond(request, requestIndex);

        throwIf(
            requestIndex >= this.responses.length,
            `ScriptedChatTransport has no response for request ${requestIndex + 1}.`
        );
        return this.responses[requestIndex];
    }

    private async *playAsync(
        response: ScriptedResponse,
        signal: AbortSignal
    ): AsyncGenerator<ChatEvent> {
        if (!isArray(response)) {
            for await (const event of response) {
                signal.throwIfAborted();
                yield event;
            }
            return;
        }

        for (const item of flattenDeep(response) as Array<ChatEvent | ScriptedDelay>) {
            if (!('type' in item)) {
                await sleepAsync(item.delayMs, signal);
                continue;
            }
            if (this.delayMs) await sleepAsync(this.delayMs, signal);
            signal.throwIfAborted();
            yield item;
        }
    }
}

//------------------
// Event builders
//------------------
/** Options for {@link textEvents}. */
export interface ScriptedTextOptions {
    /** Id of the text message. Default generated. */
    messageId?: string;

    /** Longest chunk to stream at once, in characters. Default 5, about one token. */
    chunkSize?: number;
}

/**
 * Events that stream `text` as one assistant text message, in small chunks that may split words
 * and markdown syntax, as a model's tokens do.
 */
export function textEvents(text: string, opts: ScriptedTextOptions = {}): ChatEvent[] {
    const {messageId = genChatId(), chunkSize = 5} = opts;
    return [
        {type: 'TEXT_MESSAGE_START', messageId, role: 'assistant'},
        ...chunkText(text, chunkSize).map((delta): ChatEvent => ({
            type: 'TEXT_MESSAGE_CONTENT',
            messageId,
            delta
        })),
        {type: 'TEXT_MESSAGE_END', messageId}
    ];
}

/** Options for {@link reasoningEvents}. */
export interface ScriptedReasoningOptions extends ScriptedTextOptions {
    /** Opaque provider data to send with the reasoning, such as a thinking signature. */
    encryptedValue?: string;
}

/** Events that stream `text` as the model's reasoning, ahead of its answer. */
export function reasoningEvents(text: string, opts: ScriptedReasoningOptions = {}): ChatEvent[] {
    const {messageId = genChatId(), chunkSize = 5, encryptedValue} = opts,
        events: ChatEvent[] = [
            {type: 'REASONING_START', messageId},
            {type: 'REASONING_MESSAGE_START', messageId, role: 'reasoning'},
            ...chunkText(text, chunkSize).map((delta): ChatEvent => ({
                type: 'REASONING_MESSAGE_CONTENT',
                messageId,
                delta
            })),
            {type: 'REASONING_MESSAGE_END', messageId}
        ];

    if (encryptedValue != null) {
        events.push({
            type: 'REASONING_ENCRYPTED_VALUE',
            subtype: 'message',
            entityId: messageId,
            encryptedValue
        });
    }
    events.push({type: 'REASONING_END', messageId});
    return events;
}

/** Options for {@link toolCallEvents}. */
export interface ScriptedToolCallOptions {
    /** Id of the tool call. Default generated. */
    toolCallId?: string;

    /** Longest chunk of the arguments' JSON to stream at once, in characters. Default 12. */
    chunkSize?: number;

    /**
     * Result of the call, to simulate a tool the backend runs. Strings are sent as is, anything
     * else as JSON. Leave out for a client tool, which the chat runs itself.
     */
    result?: any;
}

/** Events for the model calling a tool, with its arguments streamed as JSON. */
export function toolCallEvents(
    toolName: string,
    input: PlainObject = {},
    opts: ScriptedToolCallOptions = {}
): ChatEvent[] {
    const {toolCallId = genChatId(), chunkSize = 12, result} = opts,
        events: ChatEvent[] = [
            {type: 'TOOL_CALL_START', toolCallId, toolCallName: toolName},
            ...chunkText(JSON.stringify(input), chunkSize).map((delta): ChatEvent => ({
                type: 'TOOL_CALL_ARGS',
                toolCallId,
                delta
            })),
            {type: 'TOOL_CALL_END', toolCallId}
        ];

    if (result !== undefined) {
        events.push({
            type: 'TOOL_CALL_RESULT',
            messageId: genChatId(),
            toolCallId,
            content: isString(result) ? result : JSON.stringify(result),
            role: 'tool'
        });
    }
    return events;
}

/** Events for sources the model consulted, shown with its answer. */
export function sourceEvents(
    sources: Array<{id?: string; url?: string; title?: string; snippet?: string}>
): ChatEvent[] {
    return sources.map(value => ({type: 'CUSTOM', name: 'xh.chat.source', value}));
}

/** An event for an app-defined data part, rendered by the chat's renderer for `dataType`. */
export function dataEvents(dataType: string, data: any, opts: {id?: string} = {}): ChatEvent[] {
    return [{type: 'CUSTOM', name: 'xh.chat.data', value: {id: opts.id, dataType, data}}];
}

/** An event for a failed step. The transport ends the response after it. */
export function errorEvents(message: string, code?: string): ChatEvent[] {
    return [{type: 'RUN_ERROR', message, code}];
}

/** A pause in a scripted response, on top of the transport's `delayMs`. */
export function scriptedDelay(delayMs: number): ScriptedDelay {
    return {delayMs};
}

//------------------
// Implementation
//------------------
/** Split text into chunks of up to `size` characters, each with its leading whitespace. */
function chunkText(text: string, size: number): string[] {
    return text.match(new RegExp(`\\s*\\S{1,${size}}|\\s+$`, 'g')) ?? [];
}
