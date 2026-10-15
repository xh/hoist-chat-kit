import type {ReactElement, ReactNode} from 'react';
import {useEffect} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {fmtTime} from '@xh/hoist/format';
import {Icon} from '@xh/hoist/icon';
import {throwIf} from '@xh/hoist/utils/js';
import {type ChatComposerStatus, ChatComposerModel} from '../../../core';
import {classNames} from '../../../impl/ClassNames';
import '../../../styles/vars.scss';
import './ChatStatusRegion.scss';
import {chatSpinner} from '../../impl/ChatLiveCues';
import {ChatStatusRegionLocalModel} from './impl/ChatStatusRegionLocalModel';
import {
    getReplyStatusLabel,
    REPLY_STATUS_DISPLAY,
    type ReplyStatusIntent
} from './impl/ReplyStatusDisplay';
import {useChatClock} from './impl/useChatClock';

/** Props for {@link ChatStatusRegion}. */
export interface ChatStatusRegionProps extends HoistProps<ChatComposerModel> {
    /** Name of the assistant, for "Assistant is working". Default 'Assistant'. */
    assistantName?: string;
}

/**
 * One line above the composer that holds the thread's next action: the one status the user
 * should know before the next send, with at most one action. It collapses to nothing when there
 * is none. In order of priority:
 *
 *  - The host's reason that sending must wait.
 *  - Offline. The draft is kept, and nothing sends by itself.
 *  - A failed reply, with Try Again when a resend is retry-safe. Otherwise it says the run may
 *    still be running, and offers Refresh Status when the chat can refresh, or else Try Again.
 *    A reply the server interrupted or cancelled, or one left running, ranks with a failure.
 *  - A stalled reply, with Refresh Status when the chat can refresh. Stop stays on the composer.
 *  - A retry-safe failure for which the server asked for a wait, counting down to a retry, with
 *    Cancel. The turn retries at zero.
 *  - A reply waiting for the user's answer.
 *  - A reply in progress.
 *  - A restored draft, with Discard.
 *
 * Screen readers hear each status once, through the kit's announcer: a failure at once, the rest
 * politely, and a countdown every 10 seconds at most. The status a thread has when the region
 * mounts, or when the thread opens, is not announced.
 *
 * Uses a {@link ChatComposerModel} from props, or else the `composerModel` of the `ChatModel` in
 * context. Its states come from the turn loop, so it renders only when the composer's host is a
 * `ChatModel`. `ChatPanel` renders one above its composer.
 */
export const [ChatStatusRegion, chatStatusRegion] = hoistCmp.withFactory<ChatStatusRegionProps>({
    displayName: 'ChatStatusRegion',
    model: uses(ChatComposerModel, {optional: true}),
    className: 'xh-chat-status-region',

    render({className, assistantName = 'Assistant'}, ref) {
        const impl = useLocalModel(ChatStatusRegionLocalModel),
            {composerModel} = impl;
        throwIf(!composerModel, 'ChatStatusRegion requires a ChatComposerModel or a ChatModel.');

        const {chatModel} = composerModel,
            now = useChatClock(!!chatModel?.isBusy || !!composerModel.retryWait),
            status = chatModel ? composerModel.getStatus(now) : null,
            display = status ? getDisplay(status, assistantName) : null;

        useEffect(() => impl.noteStatus(status, display?.text), [impl, status, display?.text]);
        if (!display) return null;

        return div({
            ref,
            className: classNames(className, `xh-chat-status-region--${display.intent}`),
            items: [
                display.icon
                    ? span({className: 'xh-chat-status-region__icon', item: display.icon})
                    : null,
                span({
                    className: 'xh-chat-status-region__text',
                    title: display.text,
                    item: display.text
                }),
                actionButton(status, impl)
            ]
        });
    }
});

//------------------
// Implementation
//------------------
interface StatusDisplay {
    icon: ReactElement;
    text: string;
    intent: ReplyStatusIntent;
}

function getDisplay(status: ChatComposerStatus, assistantName: string): StatusDisplay {
    const {type, replyStatus, reason} = status,
        reply = REPLY_STATUS_DISPLAY[replyStatus],
        replyIcon = () => (typeof reply.icon === 'function' ? reply.icon() : null);

    switch (type) {
        case 'blocked':
            return {icon: Icon.warning(), text: reason, intent: 'warning'};
        case 'offline':
            return {
                icon: Icon.warning(),
                text: "Offline. Your draft is kept; send it when you're back online.",
                intent: 'warning'
            };
        case 'failed':
            return failedDisplay(status, replyIcon());
        case 'detached':
            return {icon: replyIcon(), text: 'Still working on the server.', intent: 'meta'};
        case 'stalled':
            return {
                icon: replyIcon(),
                text: `${getReplyStatusLabel('stalled', status.stalledMs)}.`,
                intent: 'warning'
            };
        case 'waitingToRetry': {
            const secs = Math.ceil(status.retryInMs / 1000);
            return {
                icon: replyIcon(),
                text: join(reason, `Waiting to retry, ${secs} s.`),
                intent: 'meta'
            };
        }
        case 'paused':
            return {icon: replyIcon(), text: 'Waiting for your answer above.', intent: 'attention'};
        case 'busy':
            return {
                icon: chatSpinner(),
                text: `${assistantName} is working · Esc to stop`,
                intent: 'busy'
            };
        case 'draftRestored':
            return {
                icon: Icon.edit(),
                text: `Draft from ${fmtTime(status.draftSavedAt, {asHtml: true}) as string} restored.`,
                intent: 'meta'
            };
    }
    return null;
}

function failedDisplay(status: ChatComposerStatus, icon: ReactElement): StatusDisplay {
    const {replyStatus, reason, isRetrySafe} = status;
    switch (replyStatus) {
        case 'interrupted':
            return {icon, text: join('Interrupted.', reason), intent: 'warning'};
        case 'cancelledByServer':
            return {icon, text: join('Cancelled by the server.', reason), intent: 'warning'};
    }
    return isRetrySafe
        ? {icon, text: join('The reply failed.', reason), intent: 'error'}
        : {
              icon: Icon.warning(),
              text: join(reason ?? 'The reply failed.', 'It may still be running.'),
              intent: 'warning'
          };
}

function actionButton(status: ChatComposerStatus, impl: ChatStatusRegionLocalModel): ReactNode {
    switch (status.action) {
        case 'tryAgain':
            return regionButton('Try Again', Icon.refresh(), impl.tryAgain);
        case 'refreshStatus':
            return regionButton(
                'Refresh Status',
                Icon.refresh(),
                impl.refreshStatus,
                impl.refreshTask.isPending
            );
        case 'cancelRetry':
            return regionButton('Cancel', null, impl.cancelRetry);
        case 'discardDraft':
            return regionButton('Discard', null, impl.discardDraft);
    }
    return null;
}

function regionButton(
    text: string,
    icon: ReactElement,
    onClick: () => void,
    disabled: boolean = false
): ReactNode {
    return button({
        className: 'xh-chat-status-region__action',
        text,
        icon,
        minimal: true,
        disabled,
        onClick
    });
}

function join(...parts: string[]): string {
    return parts.filter(Boolean).join(' ');
}
