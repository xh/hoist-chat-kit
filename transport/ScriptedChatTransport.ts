import type {Interrupt} from '@ag-ui/core';
import type {Awaitable, PlainObject} from '@xh/hoist/core';
import {throwIf} from '@xh/hoist/utils/js';
import {findLast, flattenDeep, isArray, isEmpty, isNil, isString, omitBy, pick} from 'lodash';
import type {ChatMessage, ChatSourceType} from '../core';
// Past the core barrel, which imports this package - a runtime import through it would be a cycle.
import {CHAT_NO_ANSWER_DATA_TYPE, type ChatNoAnswerData} from '../core/ChatNoAnswer';
import {sleepAsync} from '../impl/abort';
import {genChatId} from '../impl/ids';
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
     * @param context - where the request falls in the conversation: its turn, its step within
     *      the turn, and how many times the user message has been answered before.
     */
    respond?: (
        request: ChatRunRequest,
        context: ScriptedRequestContext
    ) => Awaitable<ScriptedResponse>;

    /** Pause before each scripted event, in milliseconds. Default 25. Use 0 in tests. */
    delayMs?: number;
}

/** Where a request falls in the conversation - passed to {@link ScriptedChatTransportConfig.respond}. */
export interface ScriptedRequestContext {
    /** Zero-based count of the requests this transport has received before this one. */
    requestIndex: number;

    /** Zero-based count of the turns this transport has answered before this one. */
    turnIndex: number;

    /**
     * Zero-based index of the step within its turn - 0 for the first model call, 1 for the call
     * that follows the first round of client tool calls, and so on. The request's `stepIndex`.
     */
    stepIndex: number;

    /** The user message the turn answers - the one with the request's `turnId` - or null. */
    userMessage: ChatMessage;

    /**
     * Zero-based count of the earlier turns that answered the same user message - 1 for the first
     * retry or regenerate. Lets a script fail the first attempt and succeed on retry.
     */
    attempt: number;
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

    /** True - a script reads the `resume` list from each request. */
    readonly supportsInterrupts = true;

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
            context = this.createContext(request);
        this.requests.push(request);

        const response = await this.getResponseAsync(request, context);
        let isStarted = false,
            started = {threadId, runId};
        for await (const event of this.playAsync(response, signal)) {
            if (!isStarted && event.type !== 'RUN_STARTED') {
                yield {type: 'RUN_STARTED', threadId, runId};
            }
            isStarted = true;
            if (event.type === 'RUN_STARTED') started = event;
            if (event.type === 'RUN_FINISHED') {
                // A script may leave the run's ids to the transport - see `interruptEvents()`.
                yield {
                    ...event,
                    threadId: event.threadId ?? started.threadId,
                    runId: event.runId ?? started.runId
                };
                return;
            }
            yield event;
            if (event.type === 'RUN_ERROR') return;
        }

        if (!isStarted) yield {type: 'RUN_STARTED', threadId, runId};
        yield {type: 'RUN_FINISHED', threadId, runId};
    }

    //------------------
    // Implementation
    //------------------
    private readonly responses: ScriptedResponse[];
    private readonly respond: ScriptedChatTransportConfig['respond'];

    // Turns answered so far, and the count of turns per user message.
    private turnCount = 0;
    private readonly turnsByMessage = new Map<string, number>();

    private createContext(request: ChatRunRequest): ScriptedRequestContext {
        const {messages, stepIndex, turnId} = request,
            userMessage = findLast(messages, it => it.id === turnId) ?? null,
            messageKey = turnId ?? '';

        if (stepIndex === 0) {
            this.turnCount++;
            this.turnsByMessage.set(messageKey, (this.turnsByMessage.get(messageKey) ?? 0) + 1);
        }
        return {
            requestIndex: this.requests.length,
            turnIndex: this.turnCount - 1,
            stepIndex,
            userMessage,
            attempt: (this.turnsByMessage.get(messageKey) ?? 1) - 1
        };
    }

    private async getResponseAsync(
        request: ChatRunRequest,
        context: ScriptedRequestContext
    ): Promise<ScriptedResponse> {
        const {requestIndex} = context;
        if (this.respond) return this.respond(request, context);

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

    /** Error message, to simulate a backend tool that fails. Sent in place of a result. */
    error?: string;

    /** The sub-agent making the call. Set for you by {@link subagentEvents}. */
    subagentRunId?: string;
}

/** Events for the model calling a tool, with its arguments streamed as JSON. */
export function toolCallEvents(
    toolName: string,
    input: PlainObject = {},
    opts: ScriptedToolCallOptions = {}
): ChatEvent[] {
    const {toolCallId = genChatId(), chunkSize = 12, result, error, subagentRunId} = opts,
        events: ChatEvent[] = [
            {
                type: 'TOOL_CALL_START',
                toolCallId,
                toolCallName: toolName,
                ...(subagentRunId != null ? {subagentRunId} : {})
            },
            ...chunkText(JSON.stringify(input), chunkSize).map((delta): ChatEvent => ({
                type: 'TOOL_CALL_ARGS',
                toolCallId,
                delta
            })),
            {type: 'TOOL_CALL_END', toolCallId}
        ];

    if (error != null) {
        events.push({
            type: 'TOOL_CALL_RESULT',
            messageId: genChatId(),
            toolCallId,
            content: error,
            role: 'tool',
            metadata: {error}
        });
    } else if (result !== undefined) {
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

/** Options for {@link subagentEvents}. */
export interface ScriptedSubagentOptions {
    /** Id of the sub-agent's run. Default generated. */
    subagentRunId?: string;

    /** What the sub-agent was asked to do. */
    description?: string;

    /** What the sub-agent found, shown as its result line. */
    result?: any;

    /** Error message, to end the sub-agent as failed in place of a result. */
    error?: string;
}

/**
 * Events for a sub-agent that does part of the work: its start, the events in `items` - which
 * may include pauses and nested sub-agents - and its end. Tool calls and activities in `items` are
 * marked as the sub-agent's. Its calls nest under it in the activity timeline, and so do its
 * activities whose type's spec has `display: 'timeline'`:
 *
 * ```ts
 * subagentEvents('Limits Checker', [
 *     toolCallEvents('read_policy', {file: 'Risk Policy.pdf'}, {result: 'ok'}),
 *     toolCallEvents('fetch_marks', {desk: 'Rates'}, {error: '504 Timeout'})
 * ], {description: 'Compare exposure to limits', result: '2 desks over limit.'})
 * ```
 */
export function subagentEvents(
    name: string,
    items: ScriptedItem[],
    opts: ScriptedSubagentOptions = {}
): ScriptedItem[] {
    const {subagentRunId = genChatId(), description, result, error} = opts,
        inner = (flattenDeep(items) as Array<ChatEvent | ScriptedDelay>).map(item =>
            claimForSubagent(item, subagentRunId)
        );
    return [
        {
            type: 'SUBAGENT_STARTED',
            subagentRunId,
            name,
            ...(description != null ? {description} : {})
        },
        ...inner,
        error != null
            ? {type: 'SUBAGENT_ERROR', subagentRunId, message: error}
            : {
                  type: 'SUBAGENT_FINISHED',
                  subagentRunId,
                  ...(result !== undefined ? {result} : {})
              }
    ];
}

/** A source, as written by {@link sourceEvents}. */
export interface ScriptedSource {
    /** Id of the source. Default generated. */
    id?: string;

    /** `url` for a web page, `document` for a document. Default `url` with a `url`. */
    sourceType?: ChatSourceType;

    /** Location of the source. */
    url?: string;

    /** Title to display for the source. */
    title?: string;

    /** Short excerpt of the source. */
    snippet?: string;

    /** Number that cites the source in the text, as in `[1]`. */
    marker?: number;

    /** App-defined data about the source, such as a document id or an `excerpt`. */
    metadata?: PlainObject;
}

/**
 * Events for sources the model consulted, shown with its answer. Give each a `marker` to cite it
 * as `[n]` in the text.
 */
export function sourceEvents(sources: ScriptedSource[]): ChatEvent[] {
    return sources.map(value => ({type: 'CUSTOM', name: 'xh.chat.source', value}));
}

/** A citation, as written by {@link citationEvents}. */
export interface ScriptedCitation {
    /** Id of the citation. Default generated. */
    id?: string;

    /** Id of a source, from {@link sourceEvents}, that the citation refers to. */
    sourceId?: string;

    /** Title of the cited source. */
    title?: string;

    /** Location of the cited source. */
    url?: string;

    /** The quoted passage that supports the text. */
    citedText?: string;
}

/**
 * Events that cite sources for the text just written. Each citation attaches to the text part
 * that precedes it, and shows as a numbered chip at the end of its last paragraph:
 *
 * ```ts
 * [
 *     textEvents('Hoist apps stream replies as NDJSON.'),
 *     citationEvents([{sourceId: 'docs', title: 'Transport docs'}]),
 *     sourceEvents([{id: 'docs', url: 'https://xh.io/docs', title: 'Transport docs'}])
 * ]
 * ```
 */
export function citationEvents(citations: ScriptedCitation[]): ChatEvent[] {
    return citations.map(({id = genChatId(), ...rest}) => ({
        type: 'CUSTOM',
        name: 'xh.chat.citation',
        value: {id, ...rest}
    }));
}

/** Options for {@link activityEvents}. */
export interface ScriptedActivityOptions {
    /** Id of the activity, and of its data part. Default generated. */
    messageId?: string;

    /** The sub-agent the activity came from. Set for you by {@link subagentEvents}. */
    subagentRunId?: string;
}

/**
 * An event for an agent's activity that is not a tool call, such as a skill it loads: an AG-UI
 * `ACTIVITY_SNAPSHOT`, which becomes a data part of type `activityType`. Give the chat a
 * `ChatActivitySpec` for the type to show it as a row in the activity timeline.
 *
 * ```ts
 * activityEvents('skill', {skillId: 'equity-research', skillName: 'Equity research'})
 * ```
 */
export function activityEvents(
    activityType: string,
    content: PlainObject,
    opts: ScriptedActivityOptions = {}
): ChatEvent[] {
    const {messageId = genChatId(), subagentRunId} = opts;
    return [
        {
            type: 'ACTIVITY_SNAPSHOT',
            messageId,
            activityType,
            content,
            ...(subagentRunId != null ? {subagentRunId} : {})
        }
    ];
}

/**
 * An event for a fixed "not found" reply - a data part of type `xh.chat.noAnswer`, which the
 * message view renders from its built-in template, with no sources list and no Regenerate.
 */
export function noAnswerEvents(data: ChatNoAnswerData = {}, opts: {id?: string} = {}): ChatEvent[] {
    return dataEvents(CHAT_NO_ANSWER_DATA_TYPE, data, opts);
}

/** An event for an app-defined data part, rendered by the chat's renderer for `dataType`. */
export function dataEvents(dataType: string, data: any, opts: {id?: string} = {}): ChatEvent[] {
    return [{type: 'CUSTOM', name: 'xh.chat.data', value: {id: opts.id, dataType, data}}];
}

/**
 * An event that ends the run with AG-UI's `interrupt` outcome, to ask the user questions or to
 * approve a server tool call. The transport fills in the run's ids, and ends the response after
 * it. The chat answers in the next request's `resume` list.
 *
 * @param interrupts - each with an `id` unique within the run, a `reason`, and optionally a
 *      `message`, a `toolCallId`, a `responseSchema` and an `expiresAt`.
 */
export function interruptEvents(interrupts: Interrupt[]): ChatEvent[] {
    return [
        {
            type: 'RUN_FINISHED',
            threadId: null,
            runId: null,
            outcome: {type: 'interrupt', interrupts}
        }
    ];
}

/**
 * An event for a failed step. The transport ends the response after it.
 *
 * @param opts - `retryAfterSeconds`, the wait the backend asks for before a retry, and
 *      `retrySafe`, false if a resend of the turn could run work twice.
 */
export function errorEvents(
    message: string,
    code?: string,
    opts: {retryAfterSeconds?: number; retrySafe?: boolean} = {}
): ChatEvent[] {
    const metadata = omitBy(pick(opts, ['retryAfterSeconds', 'retrySafe']), isNil);
    return [{type: 'RUN_ERROR', message, code, ...(isEmpty(metadata) ? {} : {metadata})}];
}

/** A pause in a scripted response, on top of the transport's `delayMs`. */
export function scriptedDelay(delayMs: number): ScriptedDelay {
    return {delayMs};
}

//------------------
// Implementation
//------------------
/** Mark a tool call, or a nested sub-agent, as the work of a sub-agent - unless already marked. */
function claimForSubagent(
    item: ChatEvent | ScriptedDelay,
    subagentRunId: string
): ChatEvent | ScriptedDelay {
    if (!('type' in item)) return item;
    switch (item.type) {
        case 'TOOL_CALL_START':
        case 'TOOL_CALL_CHUNK':
        case 'ACTIVITY_SNAPSHOT':
            return item.subagentRunId != null ? item : {...item, subagentRunId};
        case 'SUBAGENT_STARTED':
            return item.parentSubagentRunId != null
                ? item
                : {...item, parentSubagentRunId: subagentRunId};
        default:
            return item;
    }
}

/** Split text into chunks of up to `size` characters, each with its leading whitespace. */
function chunkText(text: string, size: number): string[] {
    return text.match(new RegExp(`\\s*\\S{1,${size}}|\\s+$`, 'g')) ?? [];
}
