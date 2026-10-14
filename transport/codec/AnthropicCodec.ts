import type {Awaitable, PlainObject} from '@xh/hoist/core';
import {throwIf} from '@xh/hoist/utils/js';
import {
    compact,
    dropWhile,
    findLast,
    findLastIndex,
    flatMap,
    initial,
    isArray,
    isEmpty,
    isFunction,
    isNil,
    isString,
    last,
    omitBy,
    partition,
    sumBy
} from 'lodash';
import {
    type ChatFilePart,
    type ChatMessage,
    type ChatPart,
    type ChatToolCallPart,
    type ChatToolSpec,
    isToolCallFinal
} from '../../core';
import type {ChatCodec, ChatDecoder} from '../ChatCodec';
import type {ChatEvent, ChatTokenUsage} from '../ChatEvent';
import type {ChatRunRequest} from '../ChatTransport';
import {partsBySteps, toolResultText} from '../impl/history';

/** A system prompt for the Messages API - plain text, or a list of text blocks. */
export type AnthropicSystemPrompt = string | PlainObject[];

/** Configuration for an {@link AnthropicCodec}. */
export interface AnthropicCodecConfig {
    /**
     * System prompt - text, or a list of Messages API text blocks - or a function to build it for
     * each step, so that it can describe the live state of the app. The function may be async.
     * System messages in the history are appended to it. Takes precedence over `params.system`.
     */
    system?:
        AnthropicSystemPrompt | ((request: ChatRunRequest) => Awaitable<AnthropicSystemPrompt>);

    /** Model to call, e.g. 'claude-opus-5-5'. Leave out if the server sets it. */
    model?: string;

    /**
     * Most tokens the model may generate per call, sent as `max_tokens`. Leave out if the server
     * sets it.
     */
    maxTokens?: number;

    /**
     * Other fields for the request body, such as `thinking`, `output_config` or `temperature`.
     * Tools listed here - typically Anthropic server tools, such as web search - are sent ahead of
     * the chat's own tools.
     */
    params?: PlainObject;

    /**
     * True to mark prompt cache breakpoints - `cache_control: {type: 'ephemeral'}` - so that
     * Anthropic caches the prompt across the steps and turns of a chat. Default false. Marks:
     *
     *  - the last block of the history, so that each step and turn reads the conversation so far
     *    from the cache, and writes only what it adds.
     *  - the last system block - unless the app marks any system block itself, in which case its
     *    placement stands and no system block is added.
     *  - the last tool definition.
     *
     * Anthropic allows at most 4 breakpoints per request, counting those the app sets. Marks are
     * added in the order above until the limit is reached.
     *
     * A breakpoint caches everything before it, so a block that changes on every step must come
     * after the last one, unmarked. For a system prompt that ends with live state, return blocks
     * from `system` with the static part first, and mark that block with `cache_control` yourself:
     * the live block after it is then sent fresh each step, and the static part comes from the
     * cache.
     */
    cacheControl?: boolean;

    /**
     * Adjust the finished request body before it is sent - to add, change or reorder fields the
     * other options do not cover. May be async.
     */
    prepareBody?: (body: PlainObject, request: ChatRunRequest) => Awaitable<PlainObject>;
}

/**
 * Codec for the Anthropic Messages API, so that a server can relay Claude's stream as is. The
 * server forwards the request body to Anthropic (adding its API key, and the model if the client
 * leaves it out), then relays the `data` of each SSE event it receives - one JSON object per NDJSON
 * line with {@link HoistChatTransport}, or the SSE stream unchanged with {@link SseChatTransport}.
 *
 * Requests are Messages API bodies with `stream: true`. The history is rebuilt as Anthropic turns:
 * each step of an assistant turn becomes an assistant turn - its thinking (with signatures), text
 * and tool calls - followed by a user turn with the results of its tool calls, flagged `is_error`
 * for failed and denied calls. Attached images, PDFs and text files (including JSON, XML and
 * similar types) are sent as image and document blocks. Other attachments are named in a text
 * block, so that the model knows they were left out. Tools are sent as
 * `{name, description, input_schema}`. A request whose history holds no user content throws, as
 * the API would reject it.
 *
 * Decoding translates the stream into the kit's events: text, thinking with its signature, tool
 * calls with their streamed input, server tool calls such as web search with their results, and
 * citations as `xh.chat.citation` events. Data that must go back to Anthropic unchanged - the data
 * of redacted thinking, and the result blocks of server tools - is kept on the part as
 * `providerData.anthropic`. `RUN_FINISHED` reports token usage, the model, and a finish reason:
 *
 *  - `stop` - for `end_turn` and `stop_sequence`.
 *  - `length` - for `max_tokens` and `model_context_window_exceeded`.
 *  - `tool-calls` - for `tool_use`.
 *  - `content-filter` - for `refusal`.
 *  - `other` - for anything else, such as `pause_turn`.
 *
 * Anthropic's own `stop_reason` is reported alongside, as `stopReason`. An `error` event becomes
 * `RUN_ERROR`, with the Anthropic error type as its code.
 *
 * Not yet supported: continuing a `pause_turn` response. The API pauses a long server tool loop
 * and expects the client to send the paused turn back to resume it. The turn currently ends at
 * the pause, and a server tool call left without a result is dropped from the next request.
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/streaming
 */
export class AnthropicCodec implements ChatCodec {
    /** System prompt, or a function to build it per step. */
    readonly system: AnthropicCodecConfig['system'];

    /** Model to call, or null if the server sets it. */
    readonly model: string;

    /** Most tokens the model may generate per call, or null if the server sets it. */
    readonly maxTokens: number;

    /** Other fields for the request body. */
    readonly params: PlainObject;

    /** True to mark prompt cache breakpoints on the history, system prompt and tools. */
    readonly cacheControl: boolean;

    /** Final adjustment of the request body, or null. */
    readonly prepareBody: AnthropicCodecConfig['prepareBody'];

    constructor({
        system = null,
        model = null,
        maxTokens = null,
        params = {},
        cacheControl = false,
        prepareBody = null
    }: AnthropicCodecConfig = {}) {
        this.system = system;
        this.model = model;
        this.maxTokens = maxTokens;
        this.params = params;
        this.cacheControl = cacheControl;
        this.prepareBody = prepareBody;
    }

    async encodeRequest(request: ChatRunRequest): Promise<PlainObject> {
        const {model, maxTokens, params, cacheControl, prepareBody} = this,
            messages = encodeMessages(request.messages);
        throwIf(isEmpty(messages), 'AnthropicCodec cannot encode a request with no user content.');

        let system = await this.getSystemAsync(request),
            tools = [...(params.tools ?? []), ...request.tools.map(encodeTool)];
        if (cacheControl) {
            ({system, tools} = addCacheBreakpoints(system, tools, messages));
        }

        const body = {
            ...params,
            ...omitBy(
                {
                    model,
                    max_tokens: maxTokens,
                    system,
                    messages,
                    tools: isEmpty(tools) ? null : tools,
                    stream: true
                },
                isNil
            )
        };
        return prepareBody ? prepareBody(body, request) : body;
    }

    createDecoder(request: ChatRunRequest): ChatDecoder {
        const decoder = new AnthropicDecoder(request);
        return (raw, eventName) => decoder.decode(raw, eventName);
    }

    //------------------
    // Implementation
    //------------------
    private async getSystemAsync(request: ChatRunRequest): Promise<AnthropicSystemPrompt> {
        const {system, params} = this,
            base = (isFunction(system) ? await system(request) : system) ?? params.system ?? null,
            prompts = request.messages
                .filter(it => it.role === 'system' && it.text.trim())
                .map(it => it.text);

        if (isArray(base)) return [...base, ...textBlocks(prompts)];
        return compact([base, ...prompts]).join('\n\n') || null;
    }
}

//------------------
// Encoding
//------------------
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Media types, beyond `text/*`, whose content is text the model can read. */
const TEXT_TYPES = [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/yaml',
    'application/x-yaml',
    'application/sql',
    'application/csv'
];

interface Turn {
    role: 'user' | 'assistant';
    content: PlainObject[];
}

function encodeTool({name, description, parameters}: ChatToolSpec): PlainObject {
    return omitBy(
        {name, description, input_schema: parameters ?? {type: 'object', properties: {}}},
        isNil
    );
}

function textBlocks(texts: string[]): PlainObject[] {
    return texts.map(text => ({type: 'text', text}));
}

function toBlocks(system: AnthropicSystemPrompt): PlainObject[] {
    return isString(system) ? textBlocks([system]) : system;
}

/** Most cache breakpoints the Messages API accepts in one request. */
const MAX_CACHE_BREAKPOINTS = 4;

/** Content blocks of a message that may carry a cache breakpoint. */
const CACHEABLE_TYPES = ['text', 'image', 'document', 'tool_use', 'tool_result'];

/**
 * Mark prompt cache breakpoints - see {@link AnthropicCodecConfig.cacheControl}. Marks the last
 * cacheable block of the history in place, as the turns are built fresh for each request, and
 * returns the system prompt and tools, with any marks added.
 */
function addCacheBreakpoints(
    system: AnthropicSystemPrompt,
    tools: PlainObject[],
    messages: Turn[]
): {system: AnthropicSystemPrompt; tools: PlainObject[]} {
    const systemBlocks = system ? toBlocks(system) : [],
        isMarked = (it: PlainObject) => !!it?.cache_control,
        isSystemMarked = systemBlocks.some(isMarked);
    let remaining =
        MAX_CACHE_BREAKPOINTS -
        sumBy([...systemBlocks, ...tools, ...flatMap(messages, 'content')], it =>
            isMarked(it) ? 1 : 0
        );

    // 1) The history, so that the growing conversation is read from the cache.
    const lastTurn = findLast(messages, it => it.content.some(isCacheable)),
        blockIdx = lastTurn ? findLastIndex(lastTurn.content, isCacheable) : -1;
    if (remaining > 0 && blockIdx >= 0 && !isMarked(lastTurn.content[blockIdx])) {
        lastTurn.content[blockIdx] = withBreakpoint(lastTurn.content[blockIdx]);
        remaining--;
    }

    // 2) The system prompt, unless the app placed its own breakpoints there.
    if (remaining > 0 && !isEmpty(systemBlocks) && !isSystemMarked) {
        system = [...initial(systemBlocks), withBreakpoint(last(systemBlocks))];
        remaining--;
    }

    // 3) The tools.
    if (remaining > 0 && !isEmpty(tools) && !isMarked(last(tools))) {
        tools = [...initial(tools), withBreakpoint(last(tools))];
    }
    return {system, tools};
}

function isCacheable(block: PlainObject): boolean {
    return CACHEABLE_TYPES.includes(block.type);
}

function withBreakpoint(block: PlainObject): PlainObject {
    return {...block, cache_control: {type: 'ephemeral'}};
}

/**
 * The history as Anthropic turns. Consecutive turns of one role are merged, and the history opens
 * with a user turn, as the API requires.
 */
function encodeMessages(messages: ChatMessage[]): Turn[] {
    const turns: Turn[] = [],
        push = (role: Turn['role'], content: PlainObject[]) => {
            if (isEmpty(content)) return;
            const prev = last(turns);
            if (prev?.role === role) {
                prev.content.push(...content);
            } else {
                turns.push({role, content});
            }
        };

    messages.forEach(message => {
        if (message.role === 'user') {
            push('user', encodeUserContent(message.parts));
        } else if (message.role === 'assistant') {
            partsBySteps(message).forEach(parts => {
                push('assistant', flatMap(parts, encodeAssistantPart));
                push('user', compact(parts.map(encodeToolResult)));
            });
        }
    });

    return dropWhile(turns, it => it.role !== 'user');
}

/** Attachments ahead of text, as Anthropic recommends. */
function encodeUserContent(parts: ChatPart[]): PlainObject[] {
    const [files, others] = partition(parts, it => it.type === 'file') as [
        ChatFilePart[],
        ChatPart[]
    ];
    return compact([...files.map(encodeFile), ...others.map(encodeText)]);
}

function encodeText(part: ChatPart): PlainObject {
    return part.type === 'text' && part.text.trim() ? {type: 'text', text: part.text} : null;
}

function encodeFile({name, mediaType, data, url}: ChatFilePart): PlainObject {
    const source =
        data != null ? {type: 'base64', media_type: mediaType, data} : {type: 'url', url};
    if (IMAGE_TYPES.includes(mediaType)) return {type: 'image', source};
    if (mediaType === 'application/pdf') return {type: 'document', title: name, source};
    if (isTextType(mediaType) && data != null) {
        return {
            type: 'document',
            title: name,
            source: {type: 'text', media_type: 'text/plain', data: decodeBase64Text(data)}
        };
    }
    return {
        type: 'text',
        text: `[Attachment '${name}' (${mediaType}) not sent - the model cannot read this file type.]`
    };
}

function isTextType(mediaType: string): boolean {
    return (
        mediaType.startsWith('text/') ||
        TEXT_TYPES.includes(mediaType) ||
        /\+(json|xml)$/.test(mediaType)
    );
}

function encodeAssistantPart(part: ChatPart): PlainObject[] {
    switch (part.type) {
        case 'text':
            return compact([encodeText(part)]);
        case 'reasoning': {
            // Thinking without a signature (e.g. from an interrupted stream) would be rejected.
            const {text, encryptedValue, providerData} = part,
                redactedData = providerData?.anthropic?.redactedData;
            if (redactedData != null) return [{type: 'redacted_thinking', data: redactedData}];
            if (encryptedValue == null) return [];
            return [{type: 'thinking', thinking: text, signature: encryptedValue}];
        }
        case 'toolCall': {
            const {id, toolName: name, input} = part;
            switch (getCallEncoding(part)) {
                case 'server':
                    return [
                        {type: 'server_tool_use', id, name, input: input ?? {}},
                        part.providerData.anthropic.resultBlock
                    ];
                case 'tool':
                    return [{type: 'tool_use', id, name, input: input ?? {}}];
                default:
                    return [];
            }
        }
        default:
            return [];
    }
}

function encodeToolResult(part: ChatPart): PlainObject {
    if (part.type !== 'toolCall' || getCallEncoding(part) !== 'tool') return null;
    return omitBy(
        {
            type: 'tool_result',
            tool_use_id: part.id,
            content: toolResultText(part),
            is_error: part.state === 'output-available' ? null : true
        },
        isNil
    );
}

/**
 * How a tool call goes back to Anthropic: as a server tool block followed by its verbatim result
 * block, as a `tool_use` answered by a `tool_result`, or - for a call that is unfinished, or that
 * the backend ran but never returned a result for - not at all.
 */
function getCallEncoding(part: ChatToolCallPart): 'server' | 'tool' {
    if (!isToolCallFinal(part)) return null;
    if (!part.providerExecuted) return 'tool';
    if (part.providerData?.anthropic?.resultBlock) return 'server';
    return part.state === 'output-available' ? 'tool' : null;
}

function decodeBase64Text(data: string): string {
    return new TextDecoder().decode(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
}

//------------------
// Decoding
//------------------
const FINISH_REASONS: Record<string, string> = {
    end_turn: 'stop',
    stop_sequence: 'stop',
    max_tokens: 'length',
    model_context_window_exceeded: 'length',
    tool_use: 'tool-calls',
    refusal: 'content-filter'
};

/** A content block of the message being streamed. */
interface Block {
    type: string;
    id: string;
    signature?: string;
    citations?: PlainObject[];
}

/** Translates the events of one Anthropic message stream, tracking its blocks by index. */
class AnthropicDecoder {
    private readonly request: ChatRunRequest;
    private blocks = new Map<number, Block>();

    // Consecutive text blocks - as Anthropic splits text around citations - continue one text
    // message, so the cited passages render as one paragraph.
    private textId: string = null;

    private model: string = null;
    private usage: PlainObject = null;
    private stopReason: string = null;

    constructor(request: ChatRunRequest) {
        this.request = request;
    }

    decode(raw: PlainObject, eventName: string): ChatEvent[] {
        const {threadId, runId} = this.request;
        switch (raw.type ?? eventName) {
            case 'message_start': {
                const {model, usage} = raw.message ?? {};
                this.model = model ?? null;
                this.usage = usage ?? null;
                return [{type: 'RUN_STARTED', threadId, runId}];
            }
            case 'content_block_start':
                return this.startBlock(raw.index, raw.content_block);
            case 'content_block_delta':
                return this.applyDelta(this.blocks.get(raw.index), raw.delta);
            case 'content_block_stop':
                return this.stopBlock(raw.index);
            case 'message_delta':
                this.stopReason = raw.delta?.stop_reason ?? this.stopReason;
                if (raw.usage) this.usage = {...this.usage, ...raw.usage};
                return [];
            case 'message_stop':
                return [
                    ...this.closeText(),
                    {type: 'RUN_FINISHED', threadId, runId, ...this.getResults()}
                ];
            case 'error':
                return [
                    {
                        type: 'RUN_ERROR',
                        message: raw.error?.message ?? 'Unknown error.',
                        code: raw.error?.type
                    }
                ];
            default:
                return [];
        }
    }

    //------------------
    // Implementation
    //------------------
    private startBlock(index: number, block: PlainObject): ChatEvent[] {
        const {type} = block,
            ret: ChatEvent[] = type === 'text' ? [] : this.closeText();

        switch (type) {
            case 'text': {
                if (!this.textId) {
                    this.textId = `text-${index}`;
                    ret.push({
                        type: 'TEXT_MESSAGE_START',
                        messageId: this.textId,
                        role: 'assistant'
                    });
                }
                const messageId = this.textId;
                this.blocks.set(index, {
                    type,
                    id: messageId,
                    citations: [...(block.citations ?? [])]
                });
                if (block.text) {
                    ret.push({type: 'TEXT_MESSAGE_CONTENT', messageId, delta: block.text});
                }
                break;
            }
            case 'thinking':
            case 'redacted_thinking': {
                const messageId = `reasoning-${index}`;
                this.blocks.set(index, {type, id: messageId, signature: block.signature || null});
                ret.push(
                    {type: 'REASONING_START', messageId},
                    {type: 'REASONING_MESSAGE_START', messageId, role: 'reasoning'}
                );
                if (block.thinking) {
                    ret.push({type: 'REASONING_MESSAGE_CONTENT', messageId, delta: block.thinking});
                }
                if (type === 'redacted_thinking') {
                    ret.push(providerDataEvent('message', messageId, {redactedData: block.data}));
                }
                break;
            }
            case 'tool_use':
            case 'server_tool_use': {
                const {id: toolCallId, name: toolCallName, input} = block;
                this.blocks.set(index, {type, id: toolCallId});
                ret.push({type: 'TOOL_CALL_START', toolCallId, toolCallName});
                // Anthropic runs server tools - the chat must never run them as client tools.
                if (type === 'server_tool_use') {
                    ret.push({
                        type: 'CUSTOM',
                        name: 'xh.chat.providerExecuted',
                        value: {toolCallId}
                    });
                }
                // A relayed message may carry the complete input up front, with no deltas.
                if (!isEmpty(input)) {
                    ret.push({type: 'TOOL_CALL_ARGS', toolCallId, delta: JSON.stringify(input)});
                }
                break;
            }
            default:
                // Server tool results (web search, web fetch, code execution...) arrive whole.
                if (block.tool_use_id) {
                    const toolCallId = block.tool_use_id;
                    ret.push(
                        {
                            type: 'TOOL_CALL_RESULT',
                            messageId: `result-${index}`,
                            toolCallId,
                            content: JSON.stringify(block.content ?? null),
                            role: 'tool'
                        },
                        // Kept verbatim - the next request must send the block back unchanged.
                        providerDataEvent('tool-call', toolCallId, {resultBlock: block})
                    );
                }
                this.blocks.set(index, {type, id: null});
        }
        return ret;
    }

    private applyDelta(block: Block, delta: PlainObject): ChatEvent[] {
        if (!block || !delta) return [];
        const {id} = block;
        switch (delta.type) {
            case 'text_delta':
                return delta.text
                    ? [{type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: delta.text}]
                    : [];
            case 'citations_delta':
                block.citations?.push(delta.citation);
                return [];
            case 'thinking_delta':
                return delta.thinking
                    ? [{type: 'REASONING_MESSAGE_CONTENT', messageId: id, delta: delta.thinking}]
                    : [];
            case 'signature_delta':
                block.signature = (block.signature ?? '') + delta.signature;
                return [];
            case 'input_json_delta':
                return delta.partial_json
                    ? [{type: 'TOOL_CALL_ARGS', toolCallId: id, delta: delta.partial_json}]
                    : [];
            default:
                return [];
        }
    }

    private stopBlock(index: number): ChatEvent[] {
        const block = this.blocks.get(index);
        if (!block) return [];
        this.blocks.delete(index);

        const {type, id: messageId, signature, citations} = block;
        switch (type) {
            case 'text':
                // Sent after the block's text, so that they attach to the text part it opened.
                return citations.map(citation => ({
                    type: 'CUSTOM',
                    name: 'xh.chat.citation',
                    value: decodeCitation(citation)
                }));
            case 'thinking':
            case 'redacted_thinking': {
                const ret: ChatEvent[] = [{type: 'REASONING_MESSAGE_END', messageId}];
                if (signature) {
                    ret.push({
                        type: 'REASONING_ENCRYPTED_VALUE',
                        subtype: 'message',
                        entityId: messageId,
                        encryptedValue: signature
                    });
                }
                ret.push({type: 'REASONING_END', messageId});
                return ret;
            }
            case 'tool_use':
            case 'server_tool_use':
                return [{type: 'TOOL_CALL_END', toolCallId: block.id}];
            default:
                return [];
        }
    }

    private closeText(): ChatEvent[] {
        const {textId} = this;
        if (!textId) return [];
        this.textId = null;
        return [{type: 'TEXT_MESSAGE_END', messageId: textId}];
    }

    private getResults(): {metadata: PlainObject; usage?: ChatTokenUsage[]} {
        const {model, usage, stopReason} = this,
            metadata = omitBy(
                {
                    finishReason: stopReason ? (FINISH_REASONS[stopReason] ?? 'other') : null,
                    stopReason,
                    model
                },
                isNil
            );
        return usage ? {metadata, usage: [decodeUsage(usage, model)]} : {metadata};
    }
}

/** An event that keeps Anthropic data on a part, for the next request to send back. */
function providerDataEvent(
    subtype: 'message' | 'tool-call',
    entityId: string,
    data: PlainObject
): ChatEvent {
    return {
        type: 'CUSTOM',
        name: 'xh.chat.providerData',
        value: {subtype, entityId, data: {anthropic: data}}
    };
}

/**
 * Anthropic counts cache reads and writes apart from `input_tokens`. AG-UI counts them within
 * `inputTokens`, so they are added in.
 */
function decodeUsage(usage: PlainObject, model: string): ChatTokenUsage {
    const {
            input_tokens = 0,
            output_tokens = 0,
            cache_read_input_tokens = 0,
            cache_creation_input_tokens = 0
        } = usage,
        inputTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens;
    return omitBy(
        {
            provider: 'anthropic',
            model,
            inputTokens,
            outputTokens: output_tokens,
            totalTokens: inputTokens + output_tokens,
            cachedInputTokens: cache_read_input_tokens,
            cacheWriteInputTokens: cache_creation_input_tokens
        },
        isNil
    );
}

/** A citation in any of Anthropic's location formats - web search, document, or search result. */
function decodeCitation(citation: PlainObject): PlainObject {
    return omitBy(
        {
            url: citation.url,
            title: citation.title ?? citation.document_title,
            citedText: citation.cited_text
        },
        isNil
    );
}
