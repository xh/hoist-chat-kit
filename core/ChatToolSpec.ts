import type {Awaitable, PlainObject} from '@xh/hoist/core';
import type {ReactElement, ReactNode} from 'react';
import type {ChatMessage} from './ChatMessage';
import type {ChatModel} from './ChatModel';
import type {ChatToolCallPart} from './ChatPart';

/**
 * Declares a tool the model can call, and how the chat displays its calls.
 *
 * A spec with `execute` is a client tool: the {@link ChatModel} runs it in the browser when the
 * model calls it, sends the result back, and continues the turn. Client tools are how a model
 * acts on the app - changing a dashboard, opening a view, filtering a grid.
 *
 * A spec without `execute` describes a tool the backend runs. It configures only how calls to
 * that tool display, and is not sent to the model unless `sendToModel` is true.
 */
export interface ChatToolSpec {
    /** Name the model calls the tool by. */
    name: string;

    /** What the tool does and when to use it - sent to the model. */
    description?: string;

    /** JSON Schema for the tool's input object - sent to the model. */
    parameters?: PlainObject;

    /**
     * Run the tool. The return value is the result sent to the model: strings as is, anything
     * else as JSON. A thrown error becomes an error result, which the model sees and can recover
     * from.
     */
    execute?: (input: PlainObject, context: ChatToolContext) => Awaitable<any>;

    /**
     * True to have the user approve each call before it runs, or a function to decide per call.
     * Applies to client tools only. Default false.
     */
    needsApproval?: boolean | ((input: PlainObject) => boolean);

    /**
     * True to send this tool to the model. Default true for client tools, false for display-only
     * specs of backend tools.
     */
    sendToModel?: boolean;

    /** Title for the tool call card. Defaults to the tool name, humanized. */
    displayName?: string;

    /** Icon for the tool call card. */
    icon?: ReactElement;

    /** One-line summary of a call, shown next to its title - e.g. the city it looked up. */
    summary?: (part: ChatToolCallPart) => string;

    /** Custom rendering for calls to this tool, in place of the default input/output display. */
    renderer?: (part: ChatToolCallPart, context: ChatToolRenderContext) => ReactNode;
}

/** Passed to {@link ChatToolSpec.execute}. */
export interface ChatToolContext {
    chatModel: ChatModel;
    toolCallId: string;

    /** Aborts if the user stops the turn. Long-running tools should honor it. */
    signal: AbortSignal;
}

/** Passed to {@link ChatToolSpec.renderer}. */
export interface ChatToolRenderContext {
    chatModel: ChatModel;
    message: ChatMessage;
}
