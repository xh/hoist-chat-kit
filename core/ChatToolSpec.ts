import type {Awaitable, PlainObject} from '@xh/hoist/core';
import type {ReactElement, ReactNode} from 'react';
import type {ChatModel, ChatPartRenderContext} from './ChatModel';
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
     * The question that asks the user to approve a call, in place of the generic "Allow this tool
     * to run?" - a string, or a function of the call's input, which may return rich content. Say
     * what the call will do in the user's terms, such as "Sell 2,000 NVDA at market?", and name any
     * work it discards.
     */
    approvalPrompt?: string | ((input: PlainObject) => ReactNode);

    /**
     * True to render a call with `display: 'inline'` while it waits for approval, as a preview of
     * what it will show. Default false: the call renders nothing until approved, and nothing if
     * denied.
     */
    approvalPreview?: boolean;

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

    /**
     * Custom rendering for calls to this tool, in place of the default input and output display.
     * Required for an interactive tool, as the default card cannot answer a call.
     *
     * The chat renders the result as the body of a component of its own, mounted only while the
     * body shows - not while its card is collapsed. The renderer may therefore call React hooks,
     * such as `useLocalModel()` for a model it owns, as long as it follows the rules of hooks. It
     * re-renders only when its part changes, or when an observable it reads changes.
     */
    renderer?: (part: ChatToolCallPart, context: ChatPartRenderContext) => ReactNode;

    /**
     * How calls to this tool display:
     *
     *  - `card` - a collapsible card with the call's title, summary and status. Its body shows the
     *    call's input and output, or the output of `renderer`.
     *  - `inline` - the output of `renderer` alone, as part of the reply. The rendered output is
     *    the call's progress, so a status line shows only while the input streams, while the call
     *    waits for approval, and if it fails or is denied. A quiet toggle to view the input shows
     *    on hover. A denied call renders nothing, and so does a call waiting for approval,
     *    unless `approvalPreview` is set. For tools that show UI to the user, such as those of a
     *    `ChatUiCatalog`.
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
