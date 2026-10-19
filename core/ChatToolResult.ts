import type {ChatArtifact} from '../genui/ChatArtifactRegistry';

/** Options for {@link chatToolResult}. */
export interface ChatToolResultOptions {
    /**
     * Result sets the call produced, for generative UI components to show by reference. The chat
     * records them on the reply, as `metadata.artifacts`, and adds them to its artifact registry -
     * see {@link ChatModel.artifacts}. Tell the model each artifact's id in the `output`.
     */
    artifacts?: ChatArtifact[];
}

/**
 * The result of a client tool, with options for the chat. Create with {@link chatToolResult}, and
 * return it from {@link ChatToolSpec.execute}.
 */
export class ChatToolResult {
    /** The result sent to the model: strings as is, anything else as JSON. */
    readonly output: any;

    /** Result sets the call produced, or null. */
    readonly artifacts: ChatArtifact[];

    constructor(output: any, {artifacts = null}: ChatToolResultOptions = {}) {
        this.output = output;
        this.artifacts = artifacts;
    }
}

/**
 * Wrap a tool's result with options for the chat, such as the result sets it produced:
 *
 * ```
 * execute: async ({query}) => {
 *     const result = await runQueryAsync(query);
 *     return chatToolResult(`Saved ${result.totalRows} rows as ${result.id}.`, {
 *         artifacts: [{id: result.id, columns: result.columns, totalRows: result.totalRows}]
 *     });
 * }
 * ```
 *
 * @param output - the result sent to the model, as a plain result would be.
 */
export function chatToolResult(output: any, opts?: ChatToolResultOptions): ChatToolResult {
    return new ChatToolResult(output, opts);
}
