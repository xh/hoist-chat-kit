import type {PlainObject} from '@xh/hoist/core';
import {compact, find, flatMap, isEmpty, isFunction, isNil, last, map, omitBy} from 'lodash';
import {
    type ChatFilePart,
    type ChatMessage,
    type ChatPart,
    type ChatTextPart,
    type ChatToolCallPart,
    isToolCallFinal
} from '../../core';
import type {ChatCodec, ChatDecoder} from '../ChatCodec';
import type {ChatEvent} from '../ChatEvent';
import type {ChatRunRequest} from '../ChatTransport';
import {checkAgUiInput, withAgUiChecks} from '../impl/agUiChecks';
import {contextValueText, messageContext} from '../impl/context';
import {
    type AgUiMessageGroup,
    getAgUiAssistantText,
    getPartServerIds,
    groupAgUiMessages,
    takeAgUiId
} from '../impl/agUiMessages';
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

    /**
     * True to send only what the server has not seen, in server mode: the user message on the
     * first step of a turn, or, on a `continue` step, the client tool calls of the reply's last
     * step with their results. This is outside the AG-UI spec, which requires the whole history.
     * Set it only for a backend that needs it. Ignored in client mode. Default false.
     */
    newMessagesOnly?: boolean;
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
 * `parameters`. The chat's live context - see `ChatModelConfig.contextProviders` - follows the
 * codec's own `context` entries, one per provider: its description (or else its name), and its
 * value as text, or as JSON for an object. The structured context of the turn's user message,
 * from its `metadata.context`, goes last, as JSON.
 *
 * `messages` carries every message the chat holds, in both history modes, as AG-UI requires: an
 * agent "MUST treat it as the complete history it is being shown". A tool result always travels
 * with the assistant message that called the tool. Each message goes with the server's id where
 * the chat has one: a message's `metadata.serverId`, and for a reply the ids its parts keep, so
 * that it goes back as the AG-UI messages it streamed as. A backend that cannot take the whole
 * history can set `newMessagesOnly`, outside the spec. In server mode the turn's ids and options go
 * in `forwardedProps`, alongside any the app adds:
 *
 * ```
 * {turnId, trigger, runOptions, replacedMessageId, catalogVersion}
 * ```
 *
 * `replacedMessageId` is sent only for a retry or regenerate, and `catalogVersion` only for a chat
 * with a generative UI catalog. The app's own `forwardedProps` take
 * precedence over these keys.
 *
 * Before it sends a request, the codec runs the official `@ag-ui/client` check on it, which strips
 * fields AG-UI does not define and fails the turn for a malformed one.
 *
 * A request's `resume` list, which answers the interrupts of the thread's last interrupted run,
 * goes as `resume`. A server call that run left open goes back in its assistant message's
 * `toolCalls`, with no tool message, until the server sends its result.
 *
 * The kit's events are AG-UI events. Decoding runs the official `@ag-ui/client` checks on each
 * record: it drops events of an unknown `type`, strips unknown fields, expands chunk events, and
 * checks the event sequence. A stream that breaks AG-UI's rules fails the turn.
 */
export class AgUiCodec implements ChatCodec {
    /** Ambient information for the agent, or a function to build it per run. */
    readonly context: AgUiCodecConfig['context'];

    /** Values passed to the agent untouched, or a function to build them per run. */
    readonly forwardedProps: AgUiCodecConfig['forwardedProps'];

    /** The agent's state, or a function to build it per run. */
    readonly state: AgUiCodecConfig['state'];

    /** True to send only what the server has not seen, in server mode. */
    readonly newMessagesOnly: boolean;

    /** True - the codec sends the request's `resume` list, to answer interrupts. */
    readonly supportsInterrupts = true;

    constructor({
        context = null,
        forwardedProps = null,
        state = null,
        newMessagesOnly = false
    }: AgUiCodecConfig = {}) {
        this.context = context;
        this.forwardedProps = forwardedProps;
        this.state = state;
        this.newMessagesOnly = newMessagesOnly;
    }

    encodeRequest(request: ChatRunRequest): PlainObject {
        const {threadId, runId, historyMode, messages, newMessages, tools} = request,
            {context, state} = this,
            // Each id goes out once per request.
            usedIds = new Set<string>();
        return checkAgUiInput({
            threadId,
            runId,
            protocolVersion: '1.0',
            state: (isFunction(state) ? state(request) : state) ?? {},
            messages:
                this.newMessagesOnly && historyMode === 'server'
                    ? flatMap(newMessages, it => encodeNewMessage(it, usedIds))
                    : flatMap(messages, it => encodeMessage(it, usedIds)),
            tools: tools.map(({name, description, parameters}) => ({
                name,
                description: description ?? '',
                parameters: parameters ?? {type: 'object', properties: {}}
            })),
            context: [
                ...((isFunction(context) ? context(request) : context) ?? []),
                ...map(request.context, it => ({
                    description: it.description ?? it.name,
                    value: contextValueText(it.value)
                })),
                ...encodeMessageContext(request)
            ],
            forwardedProps: this.getForwardedProps(request),
            ...(isEmpty(request.resume) ? {} : {resume: request.resume})
        });
    }

    createDecoder(): ChatDecoder {
        return withAgUiChecks(raw => [raw as ChatEvent]);
    }

    //------------------
    // Implementation
    //------------------
    private getForwardedProps(request: ChatRunRequest): PlainObject {
        const {forwardedProps} = this,
            appProps =
                (isFunction(forwardedProps) ? forwardedProps(request) : forwardedProps) ?? {};
        if (request.historyMode !== 'server') return appProps;

        const {turnId, trigger, runOptions, replacedMessageId, catalogVersion} = request;
        return {
            ...omitBy({turnId, trigger, runOptions, replacedMessageId, catalogVersion}, isNil),
            ...appProps
        };
    }
}

//------------------
// Implementation
//------------------
function encodeMessage(message: ChatMessage, usedIds: Set<string>): PlainObject[] {
    if (message.isEmpty) return [];

    // The server's id, where it gave one, so that a backend that merges by id finds its own.
    const {role} = message;
    switch (role) {
        case 'user':
        case 'system': {
            const id = takeAgUiId(usedIds, message.metadata.serverId, message.id),
                content = role === 'user' ? encodeUserContent(message.parts) : message.text;
            return [{id, role, content}];
        }
        case 'assistant': {
            const baseId = getReplyBaseId(message);
            return flatMap(partsBySteps(message), (parts, idx) =>
                encodeAssistantStep(parts, idx ? `${baseId}-${idx}` : baseId, usedIds)
            );
        }
    }
}

/**
 * The id that a reply's parts with no server id of their own fall back to: the reply's server id,
 * unless one of its parts names that id for a message of its own, else the kit's id.
 */
function getReplyBaseId(message: ChatMessage): string {
    const {serverId} = message.metadata;
    return serverId != null && !getPartServerIds(message.parts).has(serverId)
        ? serverId
        : message.id;
}

/** The structured context of the turn's user message, as a context entry of each step. */
function encodeMessageContext({messages, turnId}: ChatRunRequest): AgUiContext[] {
    const context = messageContext(find(messages, {id: turnId}));
    return context
        ? [{description: MESSAGE_CONTEXT_DESCRIPTION, value: JSON.stringify(context)}]
        : [];
}

/**
 * A message the server has not seen - all of a user message, or the calls of a reply's last step
 * that the client answered, with their results. The server wrote the rest of the step, and ran
 * its own calls, so it holds them already.
 */
function encodeNewMessage(message: ChatMessage, usedIds: Set<string>): PlainObject[] {
    if (!message.isAssistant || message.isEmpty) return encodeMessage(message, usedIds);
    const steps = partsBySteps(message),
        stepIdx = steps.length - 1,
        baseId = getReplyBaseId(message),
        clientCalls = last(steps).filter(it => it.type === 'toolCall' && !it.providerExecuted);
    return encodeAssistantStep(clientCalls, stepIdx ? `${baseId}-${stepIdx}` : baseId, usedIds);
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
 * One step of an assistant turn, as the AG-UI messages it makes, with the server's ids - see
 * {@link groupAgUiMessages}. Calls not yet finished, and data parts, are left out.
 */
function encodeAssistantStep(
    parts: ChatPart[],
    defaultId: string,
    usedIds: Set<string>
): PlainObject[] {
    // A server call an interrupted run left open goes back with no result - see `awaitsResume`.
    const finished = parts.filter(
        it => it.type !== 'toolCall' || isToolCallFinal(it) || it.awaitsResume
    );
    return compact(groupAgUiMessages(finished, defaultId, usedIds).map(encodeGroup));
}

function encodeGroup(group: AgUiMessageGroup): PlainObject {
    const {id} = group;
    switch (group.role) {
        case 'reasoning': {
            const {text, encryptedValue} = group.part;
            return omitBy({id, role: 'reasoning', content: text, encryptedValue}, isNil);
        }
        case 'assistant': {
            const content = getAgUiAssistantText(group),
                {calls} = group;
            if (!content && isEmpty(calls)) return null;
            return omitBy(
                {
                    id,
                    role: 'assistant',
                    content: content || null,
                    toolCalls: isEmpty(calls) ? null : calls.map(encodeToolCall)
                },
                isNil
            );
        }
        case 'tool': {
            const {call} = group,
                content = toolResultText(call),
                error = call.state === 'output-available' ? null : content;
            return omitBy({id, role: 'tool', toolCallId: call.id, content, error}, isNil);
        }
        default:
            return null;
    }
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

const MEDIA_PART_TYPES = ['image', 'audio', 'video'],
    MESSAGE_CONTEXT_DESCRIPTION = "Context of the user's message, such as the item it is about";
