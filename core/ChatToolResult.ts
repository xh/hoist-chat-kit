import type {Awaitable} from '@xh/hoist/core';
import type {ChatArtifact} from '../genui/ChatArtifactRegistry';

/**
 * Reverts the change that one tool call made - see {@link chatToolResult}. May be async. Throw to
 * report that the change could not be undone.
 */
export type ChatToolUndo = () => Awaitable<void>;

/** Options for {@link chatToolResult}. */
export interface ChatToolResultOptions {
    /**
     * Reverts the change the call made. The chat keeps it in memory with the reply that made the
     * call, so the user can undo the reply's changes - see {@link ChatModel.undoTurnAsync}.
     */
    undo?: ChatToolUndo;

    /**
     * Result sets the call produced, for generative UI components to show by reference. The chat
     * records them on the reply, as `metadata.artifacts`, and adds them to its artifact registry -
     * see {@link ChatModel.artifacts}. Tell the model each artifact's id in the `output`.
     */
    artifacts?: ChatArtifact[];

    /**
     * What the call changed, in the component's terms - such as the columns it showed or the
     * widget it added. A helper flashes them on the component, and offers Show on the change's line
     * to flash them again - see `ChatToolGroup.highlight`. The chat itself ignores them.
     */
    targets?: ChatChangeTarget[];
}

/**
 * One thing a tool call changed on a component, for the component's tool group to highlight - see
 * {@link ChatToolResultOptions.targets}. Its group gives `type` and `id` their meaning.
 */
export interface ChatChangeTarget {
    /** What kind of thing changed, such as 'column', 'groups' or 'widget'. */
    type: string;

    /** Id of the thing that changed, such as a column or widget id. */
    id?: string;

    /** True if the call created it, so that the group can outline it and scroll it into view. */
    isNew?: boolean;
}

/**
 * The result of a client tool, with options for the chat. Create with {@link chatToolResult}, and
 * return it from {@link ChatToolSpec.execute}.
 */
export class ChatToolResult {
    /** The result sent to the model: strings as is, anything else as JSON. */
    readonly output: any;

    /** Reverts the change the call made, or null. */
    readonly undo: ChatToolUndo;

    /** Result sets the call produced, or null. */
    readonly artifacts: ChatArtifact[];

    /** What the call changed, or null. */
    readonly targets: ChatChangeTarget[];

    constructor(
        output: any,
        {undo = null, artifacts = null, targets = null}: ChatToolResultOptions = {}
    ) {
        this.output = output;
        this.undo = undo;
        this.artifacts = artifacts;
        this.targets = targets;
    }
}

/**
 * Wrap a tool's result with options for the chat - such as how to undo the change it made, or
 * the result sets it produced:
 *
 * ```
 * execute: ({colIds}) => {
 *     const prior = gridModel.columnState;
 *     colIds.forEach(it => gridModel.hideColumn(it));
 *     return chatToolResult(`Hid ${colIds.length} columns.`, {
 *         undo: () => gridModel.setColumnState(prior)
 *     });
 * }
 * ```
 *
 * @param output - the result sent to the model, as a plain result would be.
 */
export function chatToolResult(output: any, opts?: ChatToolResultOptions): ChatToolResult {
    return new ChatToolResult(output, opts);
}

/**
 * Retires the Undo of a reply whose changes no longer apply, such as when the user has since
 * changed the component by hand. A message view finds one in Hoist's model context - see
 * {@link isChatUndoGuard} - and replaces Undo with the reason. `ChatAssistantModel` implements it.
 */
export interface ChatUndoGuard {
    /** Marks the guard, for lookup in model context. */
    readonly isChatUndoGuard: true;

    /**
     * Why the changes of a reply can no longer be undone, or null if they can. Read in render, so
     * read observable state for the view to update as it changes.
     */
    getUndoRetiredReason(messageId: string): string;
}

/** True if a model is a {@link ChatUndoGuard}. */
export function isChatUndoGuard(model: unknown): boolean {
    return (model as ChatUndoGuard)?.isChatUndoGuard === true;
}
