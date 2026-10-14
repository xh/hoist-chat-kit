import type {Awaitable, PlainObject} from '@xh/hoist/core';
import {throwIf} from '@xh/hoist/utils/js';
import {compact, flatMap, groupBy, isEmpty, isFunction, isNil, isString, omitBy} from 'lodash';
import {
    type ChatFilePart,
    type ChatMessage,
    type ChatPart,
    type ChatTextPart,
    type ChatToolCallPart,
    type ChatToolSpec,
    isToolCallFinal
} from '../../core';
import {genChatId} from '../../impl/ids';
import type {ChatCodec, ChatDecoder} from '../ChatCodec';
import type {ChatEvent, ChatTokenUsage} from '../ChatEvent';
import type {ChatRunRequest} from '../ChatTransport';
import {contextText} from '../impl/context';
import {decodeBase64Text, IMAGE_TYPES, isTextType, omittedFileText} from '../impl/files';
import {partsBySteps, toolResultText} from '../impl/history';

/** Configuration for a {@link ChatCompletionsCodec}. */
export interface ChatCompletionsCodecConfig {
    /**
     * System prompt, or a function to build it for each step, so that it can describe the live
     * state of the app. The function may be async. System messages in the history and the chat's
     * live context are appended to it.
     */
    system?: string | ((request: ChatRunRequest) => Awaitable<string>);

    /** Model to call. Leave out if the server or gateway sets it. */
    model?: string;

    /**
     * Other fields for the request body, such as `temperature`, `max_completion_tokens` or
     * `reasoning_effort`. Tools listed here are sent ahead of the chat's own tools.
     */
    params?: PlainObject;

    /**
     * True to ask for token usage, with `stream_options: {include_usage: true}`. The stream then
     * ends with a chunk that holds the usage of the whole call. Default true. Set false for a
     * gateway that rejects `stream_options`.
     */
    includeUsage?: boolean;

    /**
     * Adjust the finished request body before it is sent - to add, change or reorder fields the
     * other options do not cover. May be async.
     */
    prepareBody?: (body: PlainObject, request: ChatRunRequest) => Awaitable<PlainObject>;
}

/**
 * Codec for the OpenAI chat completions API - the format that most model gateways speak, such as
 * Azure OpenAI, LiteLLM, Portkey and internal model services. A server relays the request body to
 * the gateway (adding its credentials, and the model if the client leaves it out), then relays the
 * `data` of each SSE event it receives - one JSON object per NDJSON line with
 * {@link HoistChatTransport}, or the SSE stream unchanged with {@link SseChatTransport}.
 *
 * Requests are chat completions bodies with `stream: true`. They open with one `system` message:
 * the system prompt, then any system messages from the history, then the chat's live context -
 * see `ChatModelConfig.contextProviders` - as one tagged section per provider. Each step of an
 * assistant turn becomes an `assistant` message with its text and its finished tool calls as
 * `tool_calls`, followed by a `tool` message per call with its result. A failed call's result
 * reads `Error: ...`, as the format has no error flag. Reasoning is not sent back. Attached
 * images are sent as `image_url` parts, PDFs with inline data as `file` parts, and text files as
 * text. Other attachments are named in a text part, so that the model knows they were left out.
 * Tools are sent as `{type: 'function', function: {name, description, parameters}}`.
 *
 * Decoding translates the streamed `chat.completion.chunk` records of the first choice: content
 * as text, `refusal` as text, `reasoning_content` - a field that some gateways and open models
 * add - as reasoning, and `tool_calls` fragments as tool calls. A fragment opens a call by its
 * `index`, with the call's id and name, and later fragments of that index stream its arguments.
 * The chunk that carries a `finish_reason` closes the step with `RUN_FINISHED`:
 *
 *  - `stop` - for `stop`.
 *  - `length` - for `length`.
 *  - `tool-calls` - for `tool_calls`, and the older `function_call`.
 *  - `content-filter` - for `content_filter`.
 *  - `other` - for anything else.
 *
 * The raw `finish_reason` is reported alongside, as `stopReason`, with the model. The usage
 * chunk, which follows the finish reason, is reported by a second `RUN_FINISHED` that carries
 * only `usage` - the chat adds it to the reply. A stream record with an `error` - or an SSE event
 * named `error` - becomes `RUN_ERROR`, with the error's `code`, or else its `type`, as its code.
 * The `[DONE]` sentinel never reaches the codec: {@link SseChatTransport} skips it, and a relay
 * should drop it.
 *
 * A client-mode codec: the API keeps no state, so every request must carry the whole history. A
 * request from a chat in server mode throws.
 *
 * @see https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events
 */
export class ChatCompletionsCodec implements ChatCodec {
    /** System prompt, or a function to build it per step. */
    readonly system: ChatCompletionsCodecConfig['system'];

    /** Model to call, or null if the server sets it. */
    readonly model: string;

    /** Other fields for the request body. */
    readonly params: PlainObject;

    /** True to ask for token usage. */
    readonly includeUsage: boolean;

    /** Final adjustment of the request body, or null. */
    readonly prepareBody: ChatCompletionsCodecConfig['prepareBody'];

    constructor({
        system = null,
        model = null,
        params = {},
        includeUsage = true,
        prepareBody = null
    }: ChatCompletionsCodecConfig = {}) {
        this.system = system;
        this.model = model;
        this.params = params;
        this.includeUsage = includeUsage;
        this.prepareBody = prepareBody;
    }

    async encodeRequest(request: ChatRunRequest): Promise<PlainObject> {
        throwIf(
            request.historyMode === 'server',
            "ChatCompletionsCodec needs the whole history, so it cannot serve a chat with historyMode 'server'."
        );
        const {model, params, includeUsage, prepareBody} = this,
            system = await this.getSystemAsync(request),
            messages = [
                ...(system ? [{role: 'system', content: system}] : []),
                ...flatMap(request.messages, encodeMessage)
            ],
            tools = [...(params.tools ?? []), ...request.tools.map(encodeTool)];

        const body = {
            ...params,
            ...omitBy(
                {
                    model,
                    messages,
                    tools: isEmpty(tools) ? null : tools,
                    stream: true,
                    stream_options: includeUsage
                        ? {...params.stream_options, include_usage: true}
                        : null
                },
                isNil
            )
        };
        return prepareBody ? prepareBody(body, request) : body;
    }

    createDecoder(request: ChatRunRequest): ChatDecoder {
        const decoder = new ChatCompletionsDecoder(request);
        return (raw, eventName) => decoder.decode(raw, eventName);
    }

    //------------------
    // Implementation
    //------------------
    private async getSystemAsync(request: ChatRunRequest): Promise<string> {
        const {system} = this,
            base = isFunction(system) ? await system(request) : system,
            prompts = request.messages
                .filter(it => it.role === 'system' && it.text.trim())
                .map(it => it.text);

        return compact([base, ...prompts, ...request.context.map(contextText)]).join('\n\n');
    }
}

//------------------
// Encoding
//------------------
function encodeTool({name, description, parameters}: ChatToolSpec): PlainObject {
    return {
        type: 'function',
        function: omitBy(
            {name, description, parameters: parameters ?? {type: 'object', properties: {}}},
            isNil
        )
    };
}

/** A message of the history - system messages go into the system prompt instead. */
function encodeMessage(message: ChatMessage): PlainObject[] {
    switch (message.role) {
        case 'user': {
            const content = encodeUserContent(message.parts);
            return isEmpty(content) ? [] : [{role: 'user', content}];
        }
        case 'assistant':
            return flatMap(partsBySteps(message), encodeAssistantStep);
        default:
            return [];
    }
}

/** User content as plain text, or as a list of parts when the message has attachments. */
function encodeUserContent(parts: ChatPart[]): string | PlainObject[] {
    if (parts.every(it => it.type === 'text')) return joinText(parts as ChatTextPart[]);

    return compact(
        parts.map(part => {
            switch (part.type) {
                case 'text':
                    return part.text.trim() ? {type: 'text', text: part.text} : null;
                case 'file':
                    return encodeFile(part);
                default:
                    return null;
            }
        })
    );
}

function encodeFile({name, mediaType, data, url}: ChatFilePart): PlainObject {
    const dataUrl = data != null ? `data:${mediaType};base64,${data}` : null;
    if (IMAGE_TYPES.includes(mediaType)) {
        return {type: 'image_url', image_url: {url: dataUrl ?? url}};
    }
    if (mediaType === 'application/pdf' && dataUrl) {
        return {type: 'file', file: {filename: name, file_data: dataUrl}};
    }
    if (isTextType(mediaType) && data != null) {
        return {type: 'text', text: `<file name="${name}">\n${decodeBase64Text(data)}\n</file>`};
    }
    return {type: 'text', text: omittedFileText(name, mediaType)};
}

/** One step of an assistant turn: what the model said and called, then the results of the calls. */
function encodeAssistantStep(parts: ChatPart[]): PlainObject[] {
    const {text = [], toolCall = []} = groupBy(parts, 'type'),
        toolCalls = (toolCall as ChatToolCallPart[]).filter(isToolCallFinal),
        content = joinText(text as ChatTextPart[]);
    if (!content && isEmpty(toolCalls)) return [];

    const message: PlainObject = {role: 'assistant', content: content || null};
    if (!isEmpty(toolCalls)) message.tool_calls = toolCalls.map(encodeToolCall);

    return [
        message,
        ...toolCalls.map(call => ({
            role: 'tool',
            tool_call_id: call.id,
            content:
                call.state === 'output-error' ? `Error: ${call.errorText}` : toolResultText(call)
        }))
    ];
}

function encodeToolCall({id, toolName, inputText, input}: ChatToolCallPart): PlainObject {
    return {
        id,
        type: 'function',
        function: {name: toolName, arguments: inputText || JSON.stringify(input ?? {})}
    };
}

function joinText(parts: ChatTextPart[]): string {
    return parts
        .map(it => it.text)
        .filter(it => it.trim())
        .join('\n\n');
}

//------------------
// Decoding
//------------------
const FINISH_REASONS: Record<string, string> = {
    stop: 'stop',
    length: 'length',
    tool_calls: 'tool-calls',
    function_call: 'tool-calls',
    content_filter: 'content-filter'
};

/** Translates the chunks of one chat completions stream, tracking its tool calls by index. */
class ChatCompletionsDecoder {
    private readonly request: ChatRunRequest;

    // Tool call ids, by the index that their fragments carry.
    private toolCallIds = new Map<number, string>();

    private isStarted = false;
    private isFinished = false;
    private hasUsage = false;
    private textId: string = null;
    private reasoningId: string = null;
    private model: string = null;
    private usage: PlainObject = null;

    constructor(request: ChatRunRequest) {
        this.request = request;
    }

    decode(raw: PlainObject, eventName: string): ChatEvent[] {
        if (raw.error || eventName === 'error') {
            const error = raw.error ?? raw;
            return [
                {
                    type: 'RUN_ERROR',
                    message: error.message ?? 'Unknown error.',
                    code: error.code ?? error.type
                }
            ];
        }

        const {threadId, runId} = this.request,
            ret: ChatEvent[] = [];
        if (!this.isStarted) {
            this.isStarted = true;
            ret.push({type: 'RUN_STARTED', threadId, runId});
        }
        this.model = raw.model ?? this.model;
        if (raw.usage) this.usage = raw.usage;

        if (this.isFinished) {
            // The usage chunk, after the finish reason.
            if (this.usage && !this.hasUsage) {
                this.hasUsage = true;
                ret.push({type: 'RUN_FINISHED', threadId, runId, usage: [this.decodeUsage()]});
            }
            return ret;
        }

        const choice = raw.choices?.find(it => (it.index ?? 0) === 0);
        if (!choice) return ret;

        ret.push(...this.applyDelta(choice.delta ?? {}));
        if (choice.finish_reason) ret.push(...this.finish(choice.finish_reason));
        return ret;
    }

    //------------------
    // Implementation
    //------------------
    private applyDelta(delta: PlainObject): ChatEvent[] {
        const ret: ChatEvent[] = [],
            {content, refusal, reasoning_content: reasoning, tool_calls: toolCalls} = delta;

        if (isString(reasoning) && reasoning) {
            ret.push(...this.closeText());
            if (!this.reasoningId) {
                this.reasoningId = `reasoning-${genChatId()}`;
                ret.push(
                    {type: 'REASONING_START', messageId: this.reasoningId},
                    {
                        type: 'REASONING_MESSAGE_START',
                        messageId: this.reasoningId,
                        role: 'reasoning'
                    }
                );
            }
            ret.push({
                type: 'REASONING_MESSAGE_CONTENT',
                messageId: this.reasoningId,
                delta: reasoning
            });
        }

        [content, refusal].forEach(text => {
            if (!isString(text) || !text) return;
            ret.push(...this.closeReasoning());
            if (!this.textId) {
                this.textId = `text-${genChatId()}`;
                ret.push({type: 'TEXT_MESSAGE_START', messageId: this.textId, role: 'assistant'});
            }
            ret.push({type: 'TEXT_MESSAGE_CONTENT', messageId: this.textId, delta: text});
        });

        toolCalls?.forEach((fragment: PlainObject, idx: number) => {
            const index = fragment.index ?? idx,
                args = fragment.function?.arguments;
            let toolCallId = this.toolCallIds.get(index);
            if (!toolCallId) {
                toolCallId = fragment.id ?? genChatId();
                this.toolCallIds.set(index, toolCallId);
                ret.push(...this.closeReasoning(), ...this.closeText(), {
                    type: 'TOOL_CALL_START',
                    toolCallId,
                    toolCallName: fragment.function?.name
                });
            }
            if (args) ret.push({type: 'TOOL_CALL_ARGS', toolCallId, delta: args});
        });

        return ret;
    }

    private finish(finishReason: string): ChatEvent[] {
        this.isFinished = true;
        const {threadId, runId} = this.request,
            {model, usage} = this,
            metadata = omitBy(
                {
                    finishReason: FINISH_REASONS[finishReason] ?? 'other',
                    stopReason: finishReason,
                    model
                },
                isNil
            ),
            ret: ChatEvent[] = [
                ...this.closeReasoning(),
                ...this.closeText(),
                ...[...this.toolCallIds.values()].map((toolCallId): ChatEvent => ({
                    type: 'TOOL_CALL_END',
                    toolCallId
                }))
            ];

        // Some gateways send the usage with the finish reason, rather than in a chunk of its own.
        if (usage) {
            this.hasUsage = true;
            ret.push({
                type: 'RUN_FINISHED',
                threadId,
                runId,
                metadata,
                usage: [this.decodeUsage()]
            });
        } else {
            ret.push({type: 'RUN_FINISHED', threadId, runId, metadata});
        }
        return ret;
    }

    private closeText(): ChatEvent[] {
        const {textId} = this;
        if (!textId) return [];
        this.textId = null;
        return [{type: 'TEXT_MESSAGE_END', messageId: textId}];
    }

    private closeReasoning(): ChatEvent[] {
        const {reasoningId} = this;
        if (!reasoningId) return [];
        this.reasoningId = null;
        return [
            {type: 'REASONING_MESSAGE_END', messageId: reasoningId},
            {type: 'REASONING_END', messageId: reasoningId}
        ];
    }

    /**
     * OpenAI counts cached tokens within `prompt_tokens`, and reasoning tokens within
     * `completion_tokens`, as AG-UI does.
     */
    private decodeUsage(): ChatTokenUsage {
        const {model, usage} = this,
            {prompt_tokens, completion_tokens, total_tokens} = usage;
        return omitBy(
            {
                model,
                inputTokens: prompt_tokens,
                outputTokens: completion_tokens,
                totalTokens: total_tokens,
                reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
                cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
                cacheWriteInputTokens: usage.prompt_tokens_details?.cache_write_tokens
            },
            isNil
        );
    }
}
