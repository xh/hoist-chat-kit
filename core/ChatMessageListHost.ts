import type {ChatUiCatalog} from '../genui/ChatUiCatalog';
import type {ChatFeedbackConfig, ChatFeedbackRating} from './ChatFeedback';
import type {ChatMessage} from './ChatMessage';
import type {ChatDataRenderer} from './ChatModel';
import type {ChatToolSpec} from './ChatToolSpec';

/**
 * What the message list and its message views need from the conversation they show. `ChatModel`
 * satisfies it. Implement it to show the kit's messages over an app's own state, without a
 * `ChatModel`.
 *
 * Only `messages` and `isBusy` are required. Each action is optional, and a view hides the button
 * for an action its host lacks - no Edit without `editMessageAsync`, no thumbs without
 * `submitFeedbackAsync`. The views read these members in render, so make them observable for the
 * views to update as they change.
 *
 * Part renderers receive a render context whose `chatModel` is the host when it is a `ChatModel`,
 * and null otherwise.
 */
export interface ChatMessageListHost {
    /** Messages of the conversation, oldest first. */
    readonly messages: ChatMessage[];

    /** True while a reply is in progress. Edit, Regenerate and Undo wait while busy. */
    readonly isBusy: boolean;

    /**
     * Epoch millis of the last data from the server for the reply in progress, or null - see
     * `ChatModel.lastActivityAt`. Omit it to never show a reply as stalled.
     */
    readonly lastActivityAt?: number;

    /** Milliseconds without data before a reply shows as stalled. Default `ChatKit.defaults`. */
    readonly stallAfterMs?: number;

    /** Why sending must wait, or null. An edit cannot resend while set. */
    readonly sendBlockedReason?: string;

    /**
     * Epoch millis of the app's last data refresh, or null. A reply that finished before it shows
     * "Data refreshed since" in its header.
     */
    readonly dataRefreshedAt?: number;

    /** Renderers for data parts, keyed by `dataType`. A part with none shows as JSON. */
    readonly dataRenderers?: Record<string, ChatDataRenderer>;

    /** Catalog whose component tags render in the text of replies. */
    readonly catalog?: ChatUiCatalog;

    /** The spec of a tool, for how its calls display, or null. */
    getToolSpec?(name: string): ChatToolSpec;

    /** Resend a user message with new text. Shows Edit on user messages and Edit Prompt. */
    editMessageAsync?(messageId: string, text: string): Promise<void>;

    /** Replace the last reply with a new one. Shows Regenerate on the last reply. */
    regenerateAsync?(messageId?: string): Promise<void>;

    /** True if the user can undo the changes of a reply now. Shows Undo with `undoTurnAsync`. */
    canUndoTurn?(messageId: string): boolean;

    /** Undo the changes of a reply. */
    undoTurnAsync?(messageId: string): Promise<void>;

    /** True if the host takes feedback now. Shows thumbs with `submitFeedbackAsync`. */
    readonly canSubmitFeedback?: boolean;

    /** Which ratings ask for a comment, and whether they require one. */
    readonly feedback?: ChatFeedbackConfig;

    /** Rate a reply, or clear its rating with null. Records the rating in `metadata.feedback`. */
    submitFeedbackAsync?(
        messageId: string,
        rating: ChatFeedbackRating,
        comment?: string
    ): Promise<void>;

    /** Approve a tool call waiting for approval. */
    approveToolCallAsync?(toolCallId: string, reason?: string): Promise<void>;

    /** Deny a tool call waiting for approval. */
    denyToolCallAsync?(toolCallId: string, reason?: string): Promise<void>;

    /** Stop the reply in progress. Escape stops it while focus is in the list. */
    stop?(): void;

    /** The composer, focused after an edit resends. */
    readonly composerModel?: {focus(): void};
}
