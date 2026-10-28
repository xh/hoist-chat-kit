import {Children} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
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
 * Pass the app's own actions, such as a copy button, as `items`. They lead the bar, split from the
 * thumbs as in the message view, and show even while the reply cannot be rated. Nothing else
 * renders for a message the user cannot rate: a user message, or a reply that streams, waits on
 * the user or failed.
 */
export const [ChatFeedbackControls, chatFeedbackControls] =
    hoistCmp.withFactory<ChatFeedbackControlsProps>({
        displayName: 'ChatFeedbackControls',
        className: 'xh-chat-feedback-controls',
        // Its own model, published to no child, so that the controls need no model in context.
        model: creates(ChatMessageFeedbackModel, {publishMode: 'none'}),

        render({className, model, message, host, children}) {
            const impl = model as ChatMessageFeedbackModel,
                appItems = Children.toArray(children);
            impl.configure(message, resolveFeedbackHost(host));

            const thumbs = impl.canRate
                ? feedbackThumbs(impl, !!getChatNoAnswerPart(message)).filter(it => it)
                : [];
            if (!thumbs.length && !appItems.length) return null;

            return div({
                className,
                items: [
                    div({
                        className: 'xh-chat-feedback-controls__bar',
                        role: 'group',
                        'aria-label': appItems.length ? 'Message actions' : 'Feedback',
                        items: [
                            ...appItems,
                            appItems.length && thumbs.length
                                ? span({
                                      key: 'sep',
                                      className: 'xh-chat-feedback-controls__sep',
                                      'aria-hidden': true
                                  })
                                : null,
                            ...thumbs
                        ]
                    }),
                    impl.canRate ? chatFeedbackForm({model: impl}) : null
                ]
            });
        }
    });
