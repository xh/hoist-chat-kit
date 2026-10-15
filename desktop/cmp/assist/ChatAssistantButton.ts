import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {popover} from '@xh/hoist/kit/blueprint';
import {useComposedRefs} from '@xh/hoist/utils/react';
import type {ReactElement} from 'react';
import {type ChatAssistantBadge, ChatAssistantModel} from '../../../assist';
import {ChatKit} from '../../../core';
import {classNames} from '../../../impl/ClassNames';
import '../../../styles/vars.scss';
import './ChatAssistant.scss';
import {chatAssistantView, type ChatAssistantViewProps} from './ChatAssistantView';

/** Props for {@link ChatAssistantButton}. */
export interface ChatAssistantButtonProps extends HoistProps<ChatAssistantModel> {
    /** True to show "Ask" beside the icon, for users new to the helper. Default false. */
    labelled?: boolean;

    /** Icon of the button and the helper. Default `ChatKit.defaults.assistantIcon`. */
    assistantIcon?: ReactElement;

    /** Props for the helper, when it opens in a popover. */
    viewProps?: Omit<ChatAssistantViewProps, 'model' | 'modelConfig' | 'modelRef'>;
}

/**
 * The entry button of a component helper, for the last of its panel's `headerItems`: a minimal
 * icon button, pressed while the helper is open. Its tooltip names the component and the
 * shortcut. It does not render without a backend - see `ChatAssistantModel.isEnabled`.
 *
 * While the helper is closed, a static badge says it wants attention, by priority: the turn waits
 * for the user, the last request failed, a turn runs, or a reply came in. The button's accessible
 * name carries the same words.
 *
 * When the component is too narrow to dock the helper, the helper opens in a non-modal popover
 * anchored to this button. An outside click leaves it open. Escape and Close close it.
 */
export const [ChatAssistantButton, chatAssistantButton] =
    hoistCmp.withFactory<ChatAssistantButtonProps>({
        displayName: 'ChatAssistantButton',
        model: uses(ChatAssistantModel),
        className: 'xh-chat-hbtn',

        render({model, className, labelled = false, assistantIcon, viewProps}, ref) {
            const buttonRef = useComposedRefs(ref, model.buttonRef);
            if (!model.isEnabled) return null;

            const {isOpen, badge, title} = model,
                status = badge ? BADGE_STATUS[badge] : null,
                name = `Ask about ${title}` + (status ? `, ${status.name}` : ''),
                shortcut = formatShortcut(ChatKit.defaults.shortcuts.openHelper),
                tooltip = isOpen
                    ? withShortcut('Close assistant', shortcut)
                    : (status?.tooltip ?? withShortcut(`Ask about ${title}`, shortcut)),
                icon = assistantIcon ?? ChatKit.defaults.assistantIcon(),
                btn = span({
                    className: classNames(className, {'xh-chat-hbtn--labelled': labelled}),
                    items: [
                        button({
                            ref: buttonRef,
                            icon,
                            text: labelled ? 'Ask' : undefined,
                            minimal: true,
                            active: isOpen,
                            tooltip,
                            'aria-label': name,
                            'aria-expanded': isOpen,
                            onClick: () => model.toggle()
                        }),
                        badge
                            ? span({
                                  className: `xh-chat-hbadge xh-chat-hbadge--${badge}`,
                                  'aria-hidden': true
                              })
                            : null
                    ]
                });

            if (model.mode !== 'popover') return btn;

            return popover({
                isOpen: model.isPopoverOpen,
                position: 'bottom-right',
                minimal: true,
                // Non-modal: an outside click leaves it open, and the helper handles Escape.
                canEscapeKeyClose: false,
                autoFocus: false,
                enforceFocus: false,
                popoverClassName: 'xh-chat-helper-popover',
                item: btn,
                content: chatAssistantView({model, assistantIcon, ...viewProps})
            });
        }
    });

//------------------
// Implementation
//------------------
const BADGE_STATUS: Record<ChatAssistantBadge, {name: string; tooltip: string}> = {
    attention: {name: 'waiting for you', tooltip: 'Waiting for you: Apply or Cancel'},
    error: {name: 'last request failed', tooltip: 'Last request failed'},
    busy: {name: 'working', tooltip: 'Working…'},
    ready: {name: 'new reply', tooltip: 'Reply ready'}
};

function withShortcut(text: string, shortcut: string): string {
    return shortcut ? `${text} · ${shortcut}` : text;
}

/** A combo such as `mod+i` as the user's platform writes it - "Ctrl+I" or "⌘I". */
function formatShortcut(combo: string): string {
    if (!combo) return null;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform ?? '');
    return combo
        .split('+')
        .map(it => {
            const key = it.trim().toLowerCase();
            if (key === 'mod') return isMac ? '⌘' : 'Ctrl';
            if (key === 'ctrl') return isMac ? '⌃' : 'Ctrl';
            if (key === 'shift') return isMac ? '⇧' : 'Shift';
            if (key === 'alt') return isMac ? '⌥' : 'Alt';
            return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
        })
        .join(isMac ? '' : '+');
}
