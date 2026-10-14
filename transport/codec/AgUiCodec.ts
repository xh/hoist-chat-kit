import type {PlainObject} from '@xh/hoist/core';
import {logDebug} from '@xh/hoist/utils/js';
import {compact, flatMap, groupBy, has, isEmpty, isFunction, isNil, last, omitBy} from 'lodash';
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

    /**
     * The agent's state, sent as the `state` of each run - or a function to build it per run, e.g.
     * from the app's current selection. Default an empty object.
     */
    state?: PlainObject | ((request: ChatRunRequest) => PlainObject);
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
 * Each step is sent as an AG-UI `RunAgentInput`:
 *
 * ```
 * {threadId, runId, protocolVersion: '1.0', state, messages, tools, context, forwardedProps}
 * ```
 *
 * The history becomes AG-UI messages. User messages carry their text as `content`, or a list of
 * text, image, audio, video and document parts when they have attachments. Each step of an
 * assistant turn becomes a `reasoning` message per reasoning part (with its `encryptedValue`), an
 * `assistant` message with its text as `content` and its finished tool calls as `toolCalls`, and a
 * `tool` message per call with its result - and `error`, for a failed or denied call. Tools are
 * sent as `{name, description, parameters}`, with an empty object schema for a tool that has no
 * `parameters`.
 *
 * In server mode the agent holds the history, so `messages` carries only what it has not seen:
 * the user message on the first step of a turn, or the last step of the reply - its tool calls
 * and the results the client gave them - on a `continue` step. The turn's ids and options go in
 * `forwardedProps`, alongside any the app adds:
 *
 * ```
 * {turnId, trigger, runOptions, replacedMessageId}
 * ```
 *
 * `replacedMessageId` is sent only for a retry or regenerate. The app's own `forwardedProps` take
 * precedence over these keys.
 *
 * The kit's events are AG-UI events, so decoding passes each record through as is. Records of an
 * unknown `type` are dropped.
 */
export class AgUiCodec implements ChatCodec {
    /** Ambient information for the agent, or a function to build it per run. */
    readonly context: AgUiCodecConfig['context'];

    /** Values passed to the agent untouched, or a function to build them per run. */
    readonly forwardedProps: AgUiCodecConfig['forwardedProps'];

    /** The agent's state, or a function to build it per run. */
    readonly state: AgUiCodecConfig['state'];

    constructor({context = null, forwardedProps = null, state = null}: AgUiCodecConfig = {}) {
        this.context = context;
        this.forwardedProps = forwardedProps;
        this.state = state;
    }

    encodeRequest(request: ChatRunRequest): PlainObject {
        const {threadId, runId, historyMode, messages, newMessages, tools} = request,
            {context, state} = this,
            isServerMode = historyMode === 'server';
        return {
            threadId,
            runId,
            protocolVersion: '1.0',
            state: (isFunction(state) ? state(request) : state) ?? {},
            messages: isServerMode
                ? flatMap(newMessages, encodeNewMessage)
                : flatMap(messages, encodeMessage),
            tools: tools.map(({name, description, parameters}) => ({
                name,
                description: description ?? '',
                parameters: parameters ?? {type: 'object', properties: {}}
            })),
            context: (isFunction(context) ? context(request) : context) ?? [],
            forwardedProps: this.getForwardedProps(request)
        };
    }

    createDecoder(): ChatDecoder {
        return raw => {
            if (has(EVENT_TYPES, raw?.type)) return [raw as ChatEvent];
            logDebug(['Ignored record of unknown type', raw?.type], this);
            return [];
        };
    }

    //------------------
    // Implementation
    //------------------
    private getForwardedProps(request: ChatRunRequest): PlainObject {
        const {forwardedProps} = this,
            appProps =
                (isFunction(forwardedProps) ? forwardedProps(request) : forwardedProps) ?? {};
        if (request.historyMode !== 'server') return appProps;

        const {turnId, trigger, runOptions, replacedMessageId} = request;
        return {
            ...omitBy({turnId, trigger, runOptions, replacedMessageId}, isNil),
            ...appProps
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

/** A message the server has not seen - all of a user message, or the last step of a reply. */
function encodeNewMessage(message: ChatMessage): PlainObject[] {
    if (!message.isAssistant || message.isEmpty) return encodeMessage(message);
    const steps = partsBySteps(message),
        stepIdx = steps.length - 1;
    return encodeAssistantStep(last(steps), stepIdx ? `${message.id}-${stepIdx}` : message.id);
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
