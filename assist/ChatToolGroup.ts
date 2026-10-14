import type {ChatContextProvider, ChatToolSpec} from '../core';

/**
 * A set of tools that lets the model act on one Hoist component, with what the model needs to
 * use them well - built by a factory such as {@link gridTools}. Pass its parts to a `ChatModel`:
 *
 * ```
 * const group = gridTools(gridModel);
 * new ChatModel({
 *     transport: XH.chatService.createTransport({system: group.prompt}),
 *     tools: group.tools,
 *     contextProviders: [group.contextProvider]
 * });
 * ```
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
}
