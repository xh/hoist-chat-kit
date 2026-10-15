import type {ChatMessage} from './ChatMessage';
import type {ChatSendSpec} from './ChatModel';

/**
 * What a {@link ChatComposerModel} needs from the conversation it sends to. `ChatModel` implements
 * it. Implement it to use the composer over an app's own state, without a `ChatModel`.
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
     * Send a user message. The composer calls it only when it can send - see
     * {@link ChatComposerModel.canSend} - and clears its draft as it does.
     */
    sendAsync(spec: ChatSendSpec): Promise<void>;

    /**
     * Stop the reply in progress. While busy, the composer shows a Stop button, and stops on
     * Escape, only if the host has this method.
     */
    stop?(): void;
}
