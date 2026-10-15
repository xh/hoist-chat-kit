import type {ChatChangeTarget, ChatContextProvider, ChatToolSpec} from '../core';

/**
 * A set of tools that lets the model act on one Hoist component, with what the model needs to
 * use them well - built by a factory such as {@link gridTools}. Give it to a
 * {@link ChatAssistantModel} for a helper beside the component, or pass its parts to a
 * `ChatModel`:
 *
 * ```
 * const group = gridTools(gridModel);
 * new ChatModel({
 *     transport: XH.chatService.createTransport({system: group.prompt}),
 *     tools: group.tools,
 *     contextProviders: [group.contextProvider]
 * });
 * ```
 *
 * The optional members serve a helper's UI: its title, the data boundary line, the change
 * highlight, retiring Undo after a hand edit, and the pages an answer may cite.
 */
export interface ChatToolGroup {
    /**
     * Tools that act on the component through its model's public API. Each returns an undo, and
     * each reads its input schema from the model's current state on every step.
     */
    tools: ChatToolSpec[];

    /** Describes the component's current structure to the model on every step. */
    contextProvider: ChatContextProvider;

    /** What the tools can do, and how to use them, for the system prompt. */
    prompt: string;

    /** Three prompts for the user to start with, such as suggestion chips. */
    suggestions: string[];

    /** Name of the component, such as 'Positions grid' - for a helper's header and button. */
    title?: string;

    /**
     * The kind of component, such as 'grid' or 'dashboard'. Helpers of one kind share their docked
     * width.
     */
    kind?: string;

    /**
     * One sentence that says what a helper can do for the component, for its empty state - such
     * as "I can change this grid's layout or explain any of its options."
     */
    intro?: string;

    /**
     * What the model can see of the component, in the app's words - for the data boundary line
     * above a helper's composer. Called in render, so read observable state for the line to update
     * as it changes.
     */
    boundary?(): ChatDataBoundary;

    /**
     * Capture the component's state, for {@link isChangedSince}. A helper takes one when a reply's
     * changes become undoable.
     */
    snapshot?(): unknown;

    /**
     * True if the component has changed since the snapshot - by hand, or by anything else. A
     * helper then retires the reply's Undo, which would also revert that change. Read observable
     * state, so that Undo retires as the change happens.
     */
    isChangedSince?(snapshot: unknown): boolean;

    /**
     * Flash what a change touched on the component, as Hoist flashes a changed cell - see
     * {@link ChatToolResultOptions.targets}. Skips targets it cannot show, such as hidden columns.
     *
     * @param targets - what the change touched.
     * @param opts - `scroll` to bring the targets into view, as Show on a change line does. A new
     *      target scrolls into view regardless.
     */
    highlight?(targets: ChatChangeTarget[], opts?: {scroll?: boolean}): void;

    /** Documentation pages about the component, and the only pages an answer may cite. */
    docs?: ChatDocLink[];
}

/**
 * What a helper's model can see of its component, in the app's words - see
 * {@link ChatToolGroup.boundary}. The line reads `text`. A click on it lists `shared` and
 * `notShared`.
 */
export interface ChatDataBoundary {
    /** The line, such as 'Sees column names and filters, not row data'. */
    text: string;

    /** What the model sees, one item per entry. */
    shared?: string[];

    /** What the model never sees, one item per entry. */
    notShared?: string[];

    /** True if an administrator limited what the model sees. The line adds a lock. */
    isLimitedByAdmin?: boolean;
}

/** A documentation page that a helper's answers may cite - see {@link ChatToolGroup.docs}. */
export interface ChatDocLink {
    /** Title of the page, such as 'Grid > Column autosizing'. */
    title: string;

    /** Address of the page. */
    url: string;

    /** What the page covers, for the model to pick the right one. */
    description?: string;
}
