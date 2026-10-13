import type {PlainObject} from '@xh/hoist/core';
import {logDebug} from '@xh/hoist/utils/js';
import {compact, flatMap, groupBy, has, isEmpty, isFunction, isNil, omitBy} from 'lodash';
import {
    type ChatFilePart,
    type ChatMessage,
    type ChatPart,
    type ChatReasoningPart,
    type ChatTextPart,
    type ChatToolCallPart,
    isToolCallFinal
} from '../../core';
import type {ChatCodec, ChatDecoder} from '../ChatCodec';
import type {ChatEvent, ChatEventType} from '../ChatEvent';
import type {ChatRunRequest} from '../ChatTransport';
import {partsBySteps, toolResultText} from '../impl/history';

/** Configuration for an {@link AgUiCodec}. */
export interface AgUiCodecConfig {
    /**
     * Ambient information for the agent, sent as the `context` of each run - or a function to
     * build it per run, e.g. from the current state of the app. Default none.
     */
    context?: AgUiContext[] | ((request: ChatRunRequest) => AgUiContext[]);

    /**
     * App-specific values passed to the agent untouched, sent as the `forwardedProps` of each run -
     * or a function to build them per run. Default none.
     */
    forwardedProps?: PlainObject | ((request: ChatRunRequest) => PlainObject);
}

/** A named piece of ambient information for an AG-UI agent. */
export interface AgUiContext {
    /** What the context is, for the agent to interpret. */
    description: string;

    /** The context itself. */
    value: string;
}

/**
 * Codec for the AG-UI protocol (version 1.0) - the default codec of the kit's HTTP transports.
 *
 * Each model call is sent as an AG-UI `RunAgentInput`:
 *
 * ```
 * {threadId, runId, protocolVersion: '1.0', state: {}, messages, tools, context, forwardedProps}
 * ```
 *
 * The history becomes AG-UI messages. User messages carry their text as `content`, or a list of
 * text, image, audio, video and document parts when they have attachments. Each step of an
 * assistant turn becomes a `reasoning` message per reasoning part (with its `encryptedValue`), an
 * `assistant` message with its text as `content` and its finished tool calls as `toolCalls`, and a
 * `tool` message per call with its result - and `error`, for a failed or denied call. Tools are
 * sent as `{name, description, parameters}`.
 *
 * The kit's events are AG-UI events, so decoding passes each record through as is. Records of an
 * unknown `type` are dropped.
 */
export class AgUiCodec implements ChatCodec {
    readonly context: AgUiCodecConfig['context'];
    readonly forwardedProps: AgUiCodecConfig['forwardedProps'];

    constructor({context = null, forwardedProps = null}: AgUiCodecConfig = {}) {
        this.context = context;
        this.forwardedProps = forwardedProps;
    }

    encodeRequest(request: ChatRunRequest): PlainObject {
        const {threadId, runId, messages, tools} = request,
            {context, forwardedProps} = this;
        return {
            threadId,
            runId,
            protocolVersion: '1.0',
            state: {},
            messages: flatMap(messages, encodeMessage),
            tools: tools.map(({name, description, parameters}) =>
                omitBy({name, description: description ?? '', parameters}, isNil)
            ),
            context: (isFunction(context) ? context(request) : context) ?? [],
            forwardedProps:
                (isFunction(forwardedProps) ? forwardedProps(request) : forwardedProps) ?? {}
        };
    }

    createDecoder(): ChatDecoder {
        return raw => {
            if (has(EVENT_TYPES, raw?.type)) return [raw as ChatEvent];
            logDebug(['Ignored record of unknown type', raw?.type], this);
            return [];
        };
    }
}

//------------------
// Implementation
//------------------
// Typed as a record so that the compiler flags any event type missing from it.
const EVENT_TYPES: Record<ChatEventType, true> = {
    RUN_STARTED: true,
    RUN_FINISHED: true,
    RUN_ERROR: true,
    STEP_STARTED: true,
    STEP_FINISHED: true,
    TEXT_MESSAGE_START: true,
    TEXT_MESSAGE_CONTENT: true,
    TEXT_MESSAGE_END: true,
    TEXT_MESSAGE_CHUNK: true,
    REASONING_START: true,
    REASONING_MESSAGE_START: true,
    REASONING_MESSAGE_CONTENT: true,
    REASONING_MESSAGE_END: true,
    REASONING_MESSAGE_CHUNK: true,
    REASONING_END: true,
    REASONING_ENCRYPTED_VALUE: true,
    TOOL_CALL_START: true,
    TOOL_CALL_ARGS: true,
    TOOL_CALL_END: true,
    TOOL_CALL_CHUNK: true,
    TOOL_CALL_RESULT: true,
    ACTIVITY_SNAPSHOT: true,
    CUSTOM: true,
    RAW: true,
    STATE_SNAPSHOT: true,
    STATE_DELTA: true,
    MESSAGES_SNAPSHOT: true,
    ACTIVITY_DELTA: true,
    SUBAGENT_STARTED: true,
    SUBAGENT_FINISHED: true,
    SUBAGENT_ERROR: true
};

function encodeMessage(message: ChatMessage): PlainObject[] {
    if (message.isEmpty) return [];

    const {id, role} = message;
    switch (role) {
        case 'user':
            return [{id, role, content: encodeUserContent(message.parts)}];
        case 'system':
            return [{id, role, content: message.text}];
        case 'assistant':
            return flatMap(partsBySteps(message), (parts, idx) =>
                encodeAssistantStep(parts, idx ? `${id}-${idx}` : id)
            );
    }
}

/** User content as plain text, or as a list of parts when the message has attachments. */
function encodeUserContent(parts: ChatPart[]): string | PlainObject[] {
    if (parts.every(it => it.type === 'text')) return joinText(parts as ChatTextPart[]);

    return compact(
        parts.map(part => {
            switch (part.type) {
                case 'text':
                    return {type: 'text', text: part.text};
                case 'file':
                    return encodeFile(part);
                default:
                    return null;
            }
        })
    );
}

function encodeFile({mediaType, data, url}: ChatFilePart): PlainObject {
    const [category] = mediaType.split('/'),
        type = MEDIA_PART_TYPES.includes(category) ? category : 'document';
    return {
        type,
        source:
            data != null
                ? {type: 'data', value: data, mimeType: mediaType}
                : {type: 'url', value: url, mimeType: mediaType}
    };
}

/**
 * One step of an assistant turn: its reasoning, then what the model said and called, then the
 * results of the calls.
 */
function encodeAssistantStep(parts: ChatPart[], messageId: string): PlainObject[] {
    const {reasoning = [], text = [], toolCall = []} = groupBy(parts, 'type'),
        toolCalls = (toolCall as ChatToolCallPart[]).filter(isToolCallFinal),
        content = joinText(text as ChatTextPart[]),
        ret: PlainObject[] = (reasoning as ChatReasoningPart[]).map(it =>
            omitBy(
                {id: it.id, role: 'reasoning', content: it.text, encryptedValue: it.encryptedValue},
                isNil
            )
        );

    if (content || !isEmpty(toolCalls)) {
        ret.push(
            omitBy(
                {
                    id: messageId,
                    role: 'assistant',
                    content: content || null,
                    toolCalls: isEmpty(toolCalls) ? null : toolCalls.map(encodeToolCall)
                },
                isNil
            )
        );
    }

    toolCalls.forEach(call => {
        const content = toolResultText(call),
            error = call.state === 'output-available' ? null : content;
        ret.push(
            omitBy(
                {id: `${call.id}-result`, role: 'tool', toolCallId: call.id, content, error},
                isNil
            )
        );
    });

    return ret;
}

function encodeToolCall(call: ChatToolCallPart): PlainObject {
    const {id, toolName, inputText, input, encryptedValue} = call;
    return omitBy(
        {
            id,
            type: 'function',
            function: {name: toolName, arguments: inputText || JSON.stringify(input ?? {})},
            encryptedValue
        },
        isNil
    );
}

function joinText(parts: ChatTextPart[]): string {
    return parts.map(it => it.text).join('\n\n');
}

const MEDIA_PART_TYPES = ['image', 'audio', 'video'];
