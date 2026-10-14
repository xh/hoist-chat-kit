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
import type {ChatEvent, ChatTokenUsage, RunFinishedEvent} from '../ChatEvent';
import type {ChatRunRequest} from '../ChatTransport';
import {contextText, messageContextText} from '../impl/context';
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
 * the system prompt, then any system messages from the history. The chat's live context - see
 * `ChatModelConfig.contextProviders` - goes last, as a `user` message with one tagged section per
 * provider, so that a gateway's prefix cache still covers the history. Each step of an
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
 * The raw `finish_reason` is reported alongside, as `stopReason`, with the model. With
 * `includeUsage`, the usage arrives in a chunk of its own after the finish reason, so the codec
 * holds `RUN_FINISHED` back until that chunk, or until the stream ends, and reports the usage on
 * it. Each step gets exactly one `RUN_FINISHED`. A stream record with an `error` - or an SSE event
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
                ...flatMap(request.messages, encodeMessage),
                ...encodeContext(request)
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
        const decoder = new ChatCompletionsDecoder(request, this.includeUsage);
        return Object.assign(
            (raw: PlainObject, eventName: string) => decoder.decode(raw, eventName),
            {
                flush: () => decoder.flush()
            }
        );
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

        return compact([base, ...prompts]).join('\n\n');
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

/**
 * The chat's live context, as a last user message. It changes from step to step, so it goes after
 * the history, where it leaves the cached prefix of the request intact.
 */
function encodeContext(request: ChatRunRequest): PlainObject[] {
    if (isEmpty(request.context)) return [];
    return [{role: 'user', content: request.context.map(contextText).join('\n\n')}];
}

/** A message of the history - system messages go into the system prompt instead. */
function encodeMessage(message: ChatMessage): PlainObject[] {
    switch (message.role) {
        case 'user': {
            const content = encodeUserContent(message);
            return isEmpty(content) ? [] : [{role: 'user', content}];
        }
        case 'assistant':
            return flatMap(partsBySteps(message), encodeAssistantStep);
        default:
            return [];
    }
}

/**
 * User content as plain text, or as a list of parts when the message has attachments. The
 * message's context follows its text.
 */
function encodeUserContent(message: ChatMessage): string | PlainObject[] {
    const {parts} = message,
        context = messageContextText(message);
    if (parts.every(it => it.type === 'text')) {
        return compact([joinText(parts as ChatTextPart[]), context]).join('\n\n');
    }

    return compact([
        ...parts.map(part => {
            switch (part.type) {
                case 'text':
                    return part.text.trim() ? {type: 'text', text: part.text} : null;
                case 'file':
                    return encodeFile(part);
                default:
                    return null;
            }
        }),
        context ? {type: 'text', text: context} : null
    ]);
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

    // True if the stream ends with a usage chunk, which the finish waits for.
    private readonly expectsUsage: boolean;

    // Tool call ids, by the index that their fragments carry.
    private toolCallIds = new Map<number, string>();

    private isStarted = false;
    private isFinished = false;
    private textId: string = null;
    private reasoningId: string = null;
    private model: string = null;
    private usage: PlainObject = null;

    // The step's finish, held back until the usage arrives or the stream ends.
    private heldFinish: RunFinishedEvent = null;

    constructor(request: ChatRunRequest, expectsUsage: boolean) {
        this.request = request;
        this.expectsUsage = expectsUsage;
    }

    decode(raw: PlainObject, eventName: string): ChatEvent[] {
        if (raw.error || eventName === 'error') {
            const error = raw.error ?? raw;
            this.heldFinish = null;
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

        // The usage chunk, after the finish reason. A repeat finds no finish left to complete.
        if (this.isFinished) return this.usage ? [...ret, ...this.releaseFinish()] : ret;

        const choice = raw.choices?.find(it => (it.index ?? 0) === 0);
        if (!choice) return ret;

        ret.push(...this.applyDelta(choice.delta ?? {}));
        if (choice.finish_reason) ret.push(...this.finish(choice.finish_reason));
        return ret;
    }

    /** The finish, if still held back for a usage chunk that never came. */
    flush(): ChatEvent[] {
        return this.releaseFinish();
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
            metadata = omitBy(
                {
                    finishReason: FINISH_REASONS[finishReason] ?? 'other',
                    stopReason: finishReason,
                    model: this.model
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
        this.heldFinish = {type: 'RUN_FINISHED', threadId, runId, metadata};
        if (this.usage || !this.expectsUsage) ret.push(...this.releaseFinish());
        return ret;
    }

    private releaseFinish(): ChatEvent[] {
        const {heldFinish, usage} = this;
        if (!heldFinish) return [];
        this.heldFinish = null;
        return [usage ? {...heldFinish, usage: [this.decodeUsage()]} : heldFinish];
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
