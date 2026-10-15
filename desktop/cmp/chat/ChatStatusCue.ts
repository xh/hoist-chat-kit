import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import type {ChatReplyStatus} from '../../../core';
import {classNames} from '../../../impl/ClassNames';
import '../../../styles/vars.scss';
import './ChatStatusCue.scss';
import {chatSpinner} from '../../impl/ChatLiveCues';
import {getReplyStatusLabel, REPLY_STATUS_DISPLAY} from './impl/ReplyStatusDisplay';

/** Props for {@link ChatStatusCue}. */
export interface ChatStatusCueProps extends HoistProps {
    /** The status to show - see `getChatReplyStatus()`. */
    status: ChatReplyStatus;

    /**
     * Words to show in place of the status's own - for example a tool's verb, such as 'Running a
     * query', or 'Waiting for approval'. Default the status's label.
     */
    label?: string;

    /** For a `stalled` status, how long the reply has had no data, in milliseconds. */
    stalledMs?: number;

    /**
     * False to leave out the spinner of a busy status, when another element nearby shows one -
     * a reply shows one spinner at most. Default true.
     */
    showSpinner?: boolean;
}

/**
 * A reply's status as one icon and its words, on one line, in the status's color: "Thinking"
 * with a spinner, "Waiting for you", "No response for 34s". Every status has one icon, one label
 * and one color, the same wherever it shows. Idle renders nothing.
 *
 * A busy status shows Hoist's spinner at the size of the text. Under reduced motion it shows a
 * static icon instead - see `ChatKit.defaults.reducedMotionSpinner`. The words carry the status
 * in every case.
 *
 * The cue is not a live region. Screen readers hear a reply's progress from the chat's announcer.
 */
export const [ChatStatusCue, chatStatusCue] = hoistCmp.withFactory<ChatStatusCueProps>({
    displayName: 'ChatStatusCue',
    model: false,
    observer: false,
    className: 'xh-chat-status-cue',

    render({className, status, label, stalledMs, showSpinner = true}) {
        const display = REPLY_STATUS_DISPLAY[status];
        if (!display?.label) return null;

        const {icon, intent} = display,
            iconEl = icon === 'spinner' ? (showSpinner ? chatSpinner() : null) : icon();
        return span({
            className: classNames(className, `xh-chat-status-cue--${intent}`),
            items: [
                iconEl ? span({className: 'xh-chat-status-cue__icon', item: iconEl}) : null,
                span({
                    className: 'xh-chat-status-cue__text',
                    item: label ?? getReplyStatusLabel(status, stalledMs)
                })
            ]
        });
    }
});
