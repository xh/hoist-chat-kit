import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import '../../../../styles/vars.scss';
import './ChatTypingIndicator.scss';

interface ChatTypingIndicatorProps extends HoistProps {
    /** Accessible label for the indicator - for example 'Assistant is responding'. */
    label: string;
}

/**
 * Three pulsing dots, shown while the assistant works on a reply and has not yet sent content.
 * @internal
 */
export const chatTypingIndicator = hoistCmp.factory<ChatTypingIndicatorProps>({
    displayName: 'ChatTypingIndicator',
    model: false,
    observer: false,
    className: 'xh-chat-typing-indicator',

    render({className, label}) {
        return div({
            className,
            role: 'status',
            'aria-label': label,
            items: [span(), span(), span()]
        });
    }
});
