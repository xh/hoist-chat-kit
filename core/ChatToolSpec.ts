import type {Awaitable, PlainObject} from '@xh/hoist/core';
import type {ReactElement, ReactNode} from 'react';
import type {ChatMessage} from './ChatMessage';
import type {ChatModel} from './ChatModel';
import type {ChatToolCallPart} from './ChatPart';

/**
 * Declares a tool the model can call, and how the chat displays its calls. A spec describes one of
 * three kinds of tool:
 *
 *  - A client tool, with `execute`. The {@link ChatModel} runs it in the browser when the model
 *    calls it, sends the result back, and continues the turn. Client tools are how a model acts on
 *    the app - changing a dashboard, opening a view, filtering a grid.
 *  - An interactive tool, with `interactive: true`. The user answers each call - through the tool
 *    call card or a custom `renderer` - and the app passes the answer to
 *    {@link ChatModel.addToolOutputAsync}. The turn pauses until every such call is answered.
 *  - A backend tool, with neither. The backend runs it and streams its result, and the spec only
 *    configures how its calls display. A call that ends its step with no result fails with an
 *    error result, as a call to an unknown tool does, so the turn never waits on it.
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
     * True for a tool the user answers, rather than code - see the interactive tools above. Ignored
     * if `execute` is set. Default false.
     */
    interactive?: boolean;

    /**
     * True to have the user approve each call before it runs, or a function to decide per call.
     * Applies to client tools only. Default false.
     */
    needsApproval?: boolean | ((input: PlainObject) => boolean);

    /**
     * True to send this tool to the model. Default true for client and interactive tools, false
     * for backend tools, whose specs the backend declares to the model itself.
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

    /**
     * How calls to this tool display:
     *
     *  - `card` - a collapsible card with the call's title, summary and status. Its body shows the
     *    call's input and output, or the output of `renderer`.
     *  - `inline` - the output of `renderer` alone, as part of the reply, above a small caption
     *    with the title, the status while the call streams or runs, any error, and a toggle to view
     *    the input. For tools that show UI to the user, such as those of a `ChatUiCatalog`.
     *
     * Default `card`.
     */
    display?: 'card' | 'inline';
}

/** Passed to {@link ChatToolSpec.execute}. */
export interface ChatToolContext {
    /** The chat whose model called the tool. */
    chatModel: ChatModel;

    /** Id of the call being run. */
    toolCallId: string;

    /** Aborts if the user stops the turn. Long-running tools should honor it. */
    signal: AbortSignal;
}

/** Passed to {@link ChatToolSpec.renderer}. */
export interface ChatToolRenderContext {
    /** The chat that holds the call. */
    chatModel: ChatModel;

    /** The assistant message that holds the call. */
    message: ChatMessage;
}
