import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {type ChatMessage, type ChatModel, getChatReplyStatus} from '../../../../core';
import {chatElapsed} from '../ChatElapsed';
import {chatStatusCue} from '../ChatStatusCue';
import {useChatClock} from './useChatClock';

interface ChatReplyLiveStatusProps extends HoistProps {
    message: ChatMessage;
    chatModel: ChatModel;
}

/**
 * The busy segment of a reply's header while its turn runs: its status and the time taken so far,
 * as "Writing 6s". Reads the chat's activity time to show the reply as stalled after a quiet
 * spell, and ticks each second to do so. Renders nothing once the reply stops streaming.
 * @internal
 */
export const chatReplyLiveStatus = hoistCmp.factory<ChatReplyLiveStatusProps>({
    displayName: 'ChatReplyLiveStatus',
    model: false,
    className: 'xh-chat-message__live-status',

    render({className, message, chatModel}) {
        const isLive = message.isStreaming,
            now = useChatClock(isLive);
        if (!isLive) return null;

        // Activity is the chat's, and belongs to the reply its turn builds - the last message.
        const lastActivityAt =
                chatModel.lastMessage?.id === message.id ? chatModel.lastActivityAt : null,
            status = getChatReplyStatus({
                message,
                lastActivityAt,
                stallAfterMs: chatModel.stallAfterMs,
                now
            });

        return span({
            className,
            items: [
                chatStatusCue({
                    status,
                    stalledMs: lastActivityAt != null ? now - lastActivityAt : null,
                    // A running tool call shows its own spinner, and a reply shows one at most.
                    showSpinner: status !== 'runningTool'
                }),
                chatElapsed({startedAt: message.createdAt})
            ]
        });
    }
});
