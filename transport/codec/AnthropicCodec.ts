import type {PlainObject} from '@xh/hoist/core';
import {logWarn} from '@xh/hoist/utils/js';
import {
    compact,
    dropWhile,
    flatMap,
    isEmpty,
    isFunction,
    isNil,
    last,
    omitBy,
    partition
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

/** Configuration for an {@link AnthropicCodec}. */
export interface AnthropicCodecConfig {
    /**
     * System prompt - or a function to build it for each model call, so that it can describe the
     * live state of the app. System messages in the history are appended to it.
     */
    system?: string | ((request: ChatRunRequest) => string);

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
 * for failed and denied calls. Attached images, PDFs and text files are sent as image and document
 * blocks. Tools are sent as `{name, description, input_schema}`.
 *
 * Decoding translates the stream into the kit's events: text, thinking (with its signature, or the
 * data of redacted thinking, kept on the reasoning part for the next request), tool calls with
 * their streamed input, server tool calls such as web search with their results, and citations as
 * `xh.chat.citation` events. `RUN_FINISHED` reports token usage, the model, and a finish reason:
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
 * @see https://platform.claude.com/docs/en/build-with-claude/streaming
 */
export class AnthropicCodec implements ChatCodec {
    readonly system: AnthropicCodecConfig['system'];
    readonly model: string;
    readonly maxTokens: number;
    readonly params: PlainObject;

    constructor({
        system = null,
        model = null,
        maxTokens = null,
        params = {}
    }: AnthropicCodecConfig = {}) {
        this.system = system;
        this.model = model;
        this.maxTokens = maxTokens;
        this.params = params;
    }

    encodeRequest(request: ChatRunRequest): PlainObject {
        const {model, maxTokens, params} = this,
            tools = [...(params.tools ?? []), ...request.tools.map(encodeTool)];
        return {
            ...params,
            ...omitBy(
                {
                    model,
                    max_tokens: maxTokens,
                    system: this.getSystem(request),
                    messages: encodeMessages(request.messages),
                    tools: isEmpty(tools) ? null : tools,
                    stream: true
                },
                isNil
            )
        };
    }

    createDecoder(request: ChatRunRequest): ChatDecoder {
        const decoder = new AnthropicDecoder(request);
        return (raw, eventName) => decoder.decode(raw, eventName);
    }

    //------------------
    // Implementation
    //------------------
    private getSystem(request: ChatRunRequest): string {
        const {system} = this,
            prompts = request.messages.filter(it => it.role === 'system').map(it => it.text);
        return (
            compact([isFunction(system) ? system(request) : system, ...prompts]).join('\n\n') ||
            null
        );
    }
}

//------------------
// Encoding
//------------------
/**
 * Marks the data of a redacted thinking block, stored as the reasoning part's encrypted value
 * alongside thinking signatures. Signatures are base64, so they never start with it.
 */
const REDACTED_PREFIX = 'redacted_thinking:';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

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
    if (mediaType.startsWith('text/') && data != null) {
        return {
            type: 'document',
            title: name,
            source: {type: 'text', media_type: 'text/plain', data: decodeBase64Text(data)}
        };
    }
    logWarn(
        `File '${name}' not sent - the Messages API does not accept ${mediaType}.`,
        'AnthropicCodec'
    );
    return null;
}

function encodeAssistantPart(part: ChatPart): PlainObject[] {
    switch (part.type) {
        case 'text':
            return compact([encodeText(part)]);
        case 'reasoning': {
            // Thinking without a signature (e.g. from an interrupted stream) would be rejected.
            const {text, encryptedValue} = part;
            if (encryptedValue == null) return [];
            return encryptedValue.startsWith(REDACTED_PREFIX)
                ? [{type: 'redacted_thinking', data: encryptedValue.slice(REDACTED_PREFIX.length)}]
                : [{type: 'thinking', thinking: text, signature: encryptedValue}];
        }
        case 'toolCall': {
            if (!isToolCallFinal(part)) return [];
            const {id, toolName: name, input} = part;
            return isServerToolCall(part)
                ? [
                      {type: 'server_tool_use', id, name, input: input ?? {}},
                      JSON.parse(part.encryptedValue)
                  ]
                : [{type: 'tool_use', id, name, input: input ?? {}}];
        }
        default:
            return [];
    }
}

function encodeToolResult(part: ChatPart): PlainObject {
    if (part.type !== 'toolCall' || !isToolCallFinal(part) || isServerToolCall(part)) return null;
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

/** True for a call to an Anthropic server tool, whose result block the decoder kept verbatim. */
function isServerToolCall(part: ChatToolCallPart): boolean {
    return part.providerExecuted && part.encryptedValue != null;
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
                this.blocks.set(index, {
                    type,
                    id: messageId,
                    signature:
                        type === 'thinking' ? block.signature || null : REDACTED_PREFIX + block.data
                });
                ret.push(
                    {type: 'REASONING_START', messageId},
                    {type: 'REASONING_MESSAGE_START', messageId, role: 'reasoning'}
                );
                if (block.thinking) {
                    ret.push({type: 'REASONING_MESSAGE_CONTENT', messageId, delta: block.thinking});
                }
                break;
            }
            case 'tool_use':
            case 'server_tool_use': {
                const {id: toolCallId, name: toolCallName, input} = block;
                this.blocks.set(index, {type, id: toolCallId});
                ret.push({type: 'TOOL_CALL_START', toolCallId, toolCallName});
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
                        {
                            type: 'REASONING_ENCRYPTED_VALUE',
                            subtype: 'tool-call',
                            entityId: toolCallId,
                            encryptedValue: JSON.stringify(block)
                        }
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
