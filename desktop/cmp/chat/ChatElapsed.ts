import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import '../../../styles/vars.scss';
import './ChatStatusCue.scss';
import {formatTickingElapsed} from './impl/ChatFormat';
import {useChatClock} from './impl/useChatClock';

/** Props for {@link ChatElapsed}. */
export interface ChatElapsedProps extends HoistProps {
    /** Epoch millis when the work began - for a reply, its `createdAt`. */
    startedAt: number;

    /** Epoch millis when the work ended, to stop the count. Default null: it keeps ticking. */
    endedAt?: number;
}

/**
 * The time a reply or a step has taken so far, in whole seconds - `6s`, `1m 02s`. Appears once a
 * second has passed and ticks each second until `endedAt` is set. It keeps ticking under reduced
 * motion, where it tells the user the reply is still busy. Never announced to screen readers.
 */
export const [ChatElapsed, chatElapsed] = hoistCmp.withFactory<ChatElapsedProps>({
    displayName: 'ChatElapsed',
    model: false,
    observer: false,
    className: 'xh-chat-elapsed',

    render({className, startedAt, endedAt = null}) {
        const now = useChatClock(endedAt == null && startedAt != null),
            label = startedAt != null ? formatTickingElapsed((endedAt ?? now) - startedAt) : null;
        return label ? span({className, title: 'Time taken', item: label}) : null;
    }
});
