import type {ChatMessage} from './ChatMessage';
import type {ChatHistoryMode, ChatSendSpec} from './ChatModel';

/**
 * What a {@link ChatComposerModel} needs from the conversation it sends to. `ChatModel` implements
 * it. Implement it to use the composer over an app's own state, without a `ChatModel`.
 *
 * Only `isBusy` and `sendAsync` are required. Each optional member turns on a feature of the
 * composer or its status region, as its doc says.
 *
 * The composer reads these members in computed values, so make them observable for the composer
 * to update as they change.
 */
export interface ChatComposerHost {
    /** True while a reply is in progress. The composer cannot send while busy. */
    readonly isBusy: boolean;

    /**
     * Why sending must wait, or null to allow it. While set, the composer disables Send and shows
     * the reason. Omit it to never block.
     */
    readonly sendBlockedReason?: string;

    /**
     * Messages of the conversation, oldest first. Omit it to turn off
     * {@link ChatComposerModel.recallLastMessage}.
     */
    readonly messages?: Pick<ChatMessage, 'isUser' | 'text'>[];

    /**
     * Identifies the conversation. The composer saves its draft per thread, keyed by this id -
     * see `ChatKit.defaults.drafts`. Omit it to keep the draft in memory only.
     */
    readonly threadId?: string;

    /**
     * The last message of the conversation, or null. The status region reads the reply's status
     * from it - failed, stalled, paused or busy. Omit it to show only the composer's own states.
     */
    readonly lastMessage?: ChatMessage;

    /**
     * Epoch millis of the last data from the server for the step in flight, or null. Read with
     * `stallAfterMs` to show a reply as stalled. Omit it to never show stalled.
     */
    readonly lastActivityAt?: number;

    /** Milliseconds without data before a reply is stalled. Default `ChatKit.defaults`. */
    readonly stallAfterMs?: number;

    /**
     * Who owns the conversation history. In server mode, a turn that the kit lost sight of is
     * not retry-safe - see `isChatRetrySafe()`. Default 'client'.
     */
    readonly historyMode?: ChatHistoryMode;

    /**
     * Send a user message. The composer calls it only when it can send - see
     * {@link ChatComposerModel.canSend} - and clears its draft as it does.
     */
    sendAsync(spec: ChatSendSpec): Promise<void>;

    /**
     * Stop the reply in progress. While busy, the composer shows a Stop button, and stops on
     * Escape, only if the host has this method.
     */
    stop?(): void;

    /**
     * Resend the last turn. The status region offers Try Again for a failed turn, and counts
     * down to a retry that the server asked to wait for, only if the host has this method.
     */
    retryAsync?(): Promise<void>;

    /**
     * Reload the thread, to learn how a run ended that the kit lost sight of - one that stalled,
     * dropped or was left running. The status region offers Refresh Status only if the host has
     * this method, and `canRefreshStatus` is not false.
     */
    refreshStatusAsync?(): Promise<void>;

    /** False while `refreshStatusAsync` cannot run. Default true if the method exists. */
    readonly canRefreshStatus?: boolean;
}
