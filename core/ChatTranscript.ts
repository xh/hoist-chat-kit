import type {ChatUiCatalog} from '../genui/ChatUiCatalog';
import type {ChatMessage} from './ChatMessage';
import {type ChatDataRenderer, ChatModel} from './ChatModel';

/**
 * A read-only conversation, for the message list to show without a `ChatModel` - an admin's chat
 * log, say, or a saved conversation. `ChatModel` implements it.
 *
 * The list and its message views render the parts of any transcript. Actions such as Edit,
 * Regenerate, feedback and approvals need the turn loop, so they show only when the host is a
 * `ChatModel` - see {@link isChatModel}.
 *
 * The views read these members in render, so make them observable for the views to update as they
 * change.
 */
export interface ChatTranscript {
    /** Messages of the conversation, oldest first. */
    readonly messages: ChatMessage[];

    /** Renderers for data parts, keyed by `dataType`. A part with none shows as JSON. */
    readonly dataRenderers?: Record<string, ChatDataRenderer>;

    /**
     * Catalog whose components render in replies - for the tags in their text, and for calls to
     * its tools, which show as their components.
     */
    readonly catalog?: ChatUiCatalog;
}

/** True if a host is a `ChatModel`, which offers the actions a plain transcript lacks. */
export function isChatModel(host: unknown): host is ChatModel {
    return host instanceof ChatModel;
}
