import type {ReactElement, ReactNode} from 'react';
import {useEffect} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {fmtTime} from '@xh/hoist/format';
import {Icon} from '@xh/hoist/icon';
import {throwIf} from '@xh/hoist/utils/js';
import {type ChatComposerStatus, ChatComposerModel} from '../../../core';
import classNames from 'classnames';
import '../../../styles/vars.scss';
import './ChatStatusRegion.scss';
import {ChatStatusRegionLocalModel} from './impl/ChatStatusRegionLocalModel';
import {
    getReplyStatusLabel,
    REPLY_STATUS_DISPLAY,
    type ReplyStatusIntent
} from './impl/ReplyStatusDisplay';
import {useChatClock} from './impl/useChatClock';

/** Props for {@link ChatStatusRegion}. */
export interface ChatStatusRegionProps extends HoistProps<ChatComposerModel> {}

/**
 * One line above the composer that holds the thread's next action: why the user cannot send, or
 * what went wrong and what to do about it. It collapses to nothing otherwise. A reply's progress,
 * and a reply left running on the server, show in the reply itself. In order of priority:
 *
 *  - The host's reason that sending must wait. A send that the thread layer blocks while the
 *    server runs the turn shows only with Refresh Status - not while the thread layer checks on
 *    the turn on its own - and as the reply's status if the reply was left running.
 *  - Offline. The draft is kept, and nothing sends by itself.
 *  - A failed reply, with Try Again when a resend is retry-safe. Otherwise it says the run may
 *    still be running, and offers Refresh Status when the chat can refresh, or else Try Again -
 *    or nothing while the thread layer checks on the run on its own.
 *    A chat with `allowRetry` false never offers Try Again.
 *    A reply the server interrupted or cancelled ranks with a failure.
 *  - A reply left running on the server, only when the chat can refresh and the thread layer
 *    does not refresh on its own - with Refresh Status. A stalled reply, only when the chat can
 *    refresh - with Refresh Status. Stop stays on the composer.
 *  - A retry-safe failure for which the server asked for a wait, counting down to a retry, with
 *    Cancel. The turn retries at zero.
 *  - A restored draft, with Discard.
 *
 * Screen readers hear each status once, through the kit's announcer: a failure at once, the rest
 * politely, and a countdown every 10 seconds at most. A status with no line - a turn that pauses
 * for the user's answer, or a reply left running or stalled with nothing to do - is still
 * announced. The status a thread has when the region mounts, or when the thread opens, is not
 * announced.
 *
 * Uses a {@link ChatComposerModel} from props, or else the `composerModel` of the `ChatModel` in
 * context. Its states come from the turn loop, so it renders only when the composer's host is a
 * `ChatModel`. `ChatPanel` renders one above its composer.
 */
export const [ChatStatusRegion, chatStatusRegion] = hoistCmp.withFactory<ChatStatusRegionProps>({
    displayName: 'ChatStatusRegion',
    model: uses(ChatComposerModel, {optional: true}),
    className: 'xh-chat-status-region',

    render({className}, ref) {
        const impl = useLocalModel(ChatStatusRegionLocalModel),
            {composerModel} = impl;
        throwIf(!composerModel, 'ChatStatusRegion requires a ChatComposerModel or a ChatModel.');

        const {chatModel} = composerModel,
            now = useChatClock(!!chatModel?.isBusy || !!composerModel.retryWait),
            status = chatModel ? composerModel.getStatus(now) : null,
            display = status ? getDisplay(status) : null;

        useEffect(() => impl.noteStatus(status, display?.text), [impl, status, display?.text]);
        if (!display || !isShown(status)) return null;

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

    /** The whole line, for the title and the announcer. */
    text: string;
    intent: ReplyStatusIntent;
}

/**
 * True for a status the region shows as a line. A reply's progress shows in the reply, so a busy
 * or paused turn shows none. Neither does a reply left running or stalled, unless the user can act
 * on it. The announcer still reads a paused turn.
 */
function isShown(status: ChatComposerStatus): boolean {
    switch (status.type) {
        case 'busy':
        case 'paused':
            return false;
        case 'detached':
        case 'stalled':
            return status.action != null;
        default:
            return true;
    }
}

function getDisplay(status: ChatComposerStatus): StatusDisplay {
    const {type, replyStatus, reason} = status,
        // A failure that no longer waits to retry reads as the failure it is.
        isFailure = type === 'failed' && replyStatus === 'waitingToRetry',
        reply = REPLY_STATUS_DISPLAY[isFailure ? 'error' : replyStatus],
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
