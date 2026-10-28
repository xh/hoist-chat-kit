import {div} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, type HoistProps} from '@xh/hoist/core';
import {
    type ChatFeedbackHost,
    type ChatMessage,
    type ChatModel,
    getChatNoAnswerPart
} from '../../../core';
import '../../../styles/vars.scss';
import './ChatFeedbackControls.scss';
import {
    chatFeedbackForm,
    ChatMessageFeedbackModel,
    feedbackThumbs,
    resolveFeedbackHost
} from './impl/ChatFeedbackControls';

/** Props for {@link ChatFeedbackControls}. */
export interface ChatFeedbackControlsProps extends HoistProps {
    /** The reply to rate. */
    message: ChatMessage;

    /**
     * The conversation that takes the feedback: a {@link ChatFeedbackHost} of the app's own, or a
     * `ChatModel`. Nothing renders for a `ChatModel` that takes no feedback.
     */
    host: ChatFeedbackHost | ChatModel;
}

/**
 * Feedback on one reply, as the message view shows it, for a layout of the app's own: thumbs up
 * and down, then "Thanks", a failure with Retry, or "Add a comment", with the comment form below.
 * The controls behave as in the message view - see `feedback` in `ChatModelConfig`.
 *
 * They need no `ChatModel`. An app whose conversation runs elsewhere implements
 * {@link ChatFeedbackHost}: the conversation's id, the saved feedback, and a submit that takes a
 * `ChatFeedbackSpec`. The controls show a new rating while it saves, and the saved one again if
 * the save fails.
 *
 * Nothing renders for a message the user cannot rate: a user message, or a reply that streams,
 * waits on the user or failed.
 */
export const [ChatFeedbackControls, chatFeedbackControls] =
    hoistCmp.withFactory<ChatFeedbackControlsProps>({
        displayName: 'ChatFeedbackControls',
        className: 'xh-chat-feedback-controls',
        // Its own model, published to no child, so that the controls need no model in context.
        model: creates(ChatMessageFeedbackModel, {publishMode: 'none'}),

        render({className, model, message, host}) {
            const impl = model as ChatMessageFeedbackModel;
            impl.configure(message, resolveFeedbackHost(host));
            if (!impl.canRate) return null;

            return div({
                className,
                items: [
                    div({
                        className: 'xh-chat-feedback-controls__bar',
                        role: 'group',
                        'aria-label': 'Feedback',
                        items: feedbackThumbs(impl, !!getChatNoAnswerPart(message)).filter(it => it)
                    }),
                    chatFeedbackForm({model: impl})
                ]
            });
        }
    });
