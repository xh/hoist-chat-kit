import type {Awaitable} from '@xh/hoist/core';

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

    constructor(output: any, {undo = null}: ChatToolResultOptions = {}) {
        this.output = output;
        this.undo = undo;
    }
}

/**
 * Wrap a tool's result with options for the chat - such as how to undo the change it made:
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
