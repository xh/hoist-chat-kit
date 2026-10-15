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
     * from. Return {@link chatToolResult} to pass the chat options with the result, such as how
     * to undo the change the call made.
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
     * What a call will do, shown on its approval card while it waits for approval. A function of
     * the call's input, which may return rich content - such as "Will hide 3 columns: Id, Seller
     * and Region." Or true, for a tool with `display: 'inline'`, to render the call's own output
     * as the preview. Default none: an inline call renders nothing until approved, and nothing if
     * denied.
     */
    preview?: boolean | ((input: PlainObject) => ReactNode);

    /** @deprecated - use `preview: true`. */
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

    /** How calls to this tool display - see {@link ChatToolDisplay}. Default `card`. */
    display?: ChatToolDisplay;
}

/**
 * How the calls to a tool display in a reply - see {@link ChatToolSpec.display}.
 *
 *  - `card` - a quiet row with the call's title, summary and status, that opens to show the
 *    call's input and output, or the output of `renderer`. Consecutive calls of one step fold into
 *    one "Used 3 tools" row. The default.
 *  - `inline` - the output of `renderer` alone, as part of the reply. The rendered output is the
 *    call's progress, so a status line shows only while the input streams, while the call waits
 *    for approval, and if it fails or is denied. A quiet toggle to view the input shows on hover.
 *    A denied call renders nothing, and so does a call waiting for approval, unless `preview` is
 *    true. For tools that show UI to the user, such as those of a `ChatUiCatalog`.
 *  - `timeline` - a row in the reply's activity timeline: one compact block that sums up an
 *    agent's run in a single line, and opens to list every call, with the text between calls as
 *    narration. For agents that make many calls per reply.
 *  - `answer` - the call's output is part of the answer, shown in place with no row: the output
 *    of `renderer`, or else the output itself, as markdown if it is text. Status shows as for
 *    `inline`. For a tool whose result is what the user asked for, such as a final answer tool.
 *  - `pinned` - the latest call shows as the plan pinned to the top of the reply's activity
 *    timeline, and no call shows as a row. The plan is read from the call's output, or else its
 *    input, as a list of items with a title and a status (below), or rendered by `renderer`. In a reply with no timeline, each call shows as a `card`.
 *  - `hidden` - nothing, unless a call waits for the user to approve or answer it. Hidden calls
 *    count in no summary.
 *
 * A pinned plan reads its items from `items`, `steps`, `todos` or `plan`, or from a plain array.
 * Each item gives its text as `title`, `content`, `text` or `name`, and its `status` as
 * `pending`, `active` (or `in_progress`, `running`), `done` (or `completed`, `complete`) or
 * `skipped` (or `cancelled`).
 */
export type ChatToolDisplay = 'card' | 'inline' | 'timeline' | 'answer' | 'pinned' | 'hidden';

/** Passed to {@link ChatToolSpec.execute}. */
export interface ChatToolContext {
    /** The chat whose model called the tool. */
    chatModel: ChatModel;

    /** Id of the call being run. */
    toolCallId: string;

    /**
     * Aborts if the turn stops, with a {@link ChatAbortError} as its reason. Long-running tools
     * should honor it.
     */
    signal: AbortSignal;
}
