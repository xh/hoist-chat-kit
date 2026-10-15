import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {useHotkeys} from '@xh/hoist/desktop/hooks';
import {Icon} from '@xh/hoist/icon';
import {getTestId} from '@xh/hoist/utils/js';
import {createObservableRef} from '@xh/hoist/utils/react';
import type {ReactElement} from 'react';
import {ChatAssistantModel} from '../../../assist';
import {ChatKit} from '../../../core';
import {classNames} from '../../../impl/ClassNames';
import '../../../styles/vars.scss';
import {chatComposer, chatMessageList, chatStatusRegion, chatSuggestions} from '../chat';
import {getChatHotkeys} from '../chat/impl/ChatShortcuts';
import './ChatAssistant.scss';
import {chatDataBoundaryLine} from './ChatDataBoundaryLine';
import {installChatAssistantRenderers} from './impl/ChatAssistantParts';

/** Props for {@link ChatAssistantView}. */
export interface ChatAssistantViewProps extends HoistProps<ChatAssistantModel> {
    /** Icon for the header and the replies. Default `ChatKit.defaults.assistantIcon`. */
    assistantIcon?: ReactElement;

    /** Placeholder of the composer. Default "Ask about [title], or tell it what to change…". */
    placeholder?: string;

    /** Test id of the helper. Its message list and composer take `-messages` and `-composer`. */
    testId?: string;
}

/**
 * The body of a component helper, docked or in a popover: a one-line header with the icon, the
 * component's title and Close, then the conversation in compact density, the status region, the
 * data boundary line, and the composer with Start Over. An empty conversation shows the helper's
 * sentence and suggestions at the bottom, beside the composer they fill.
 *
 * Each change a reply made shows as a line, with Show to flash it again on the component. The
 * reply's Undo restores the component, until the component changes by other means.
 *
 * Opening focuses the composer, or the first approval button of a turn that waits for the user.
 * Closing returns focus to where it was before, else to the helper's button. Escape closes a
 * popup first, then stops a running reply, then closes the helper - one action per press.
 *
 * Rendered by {@link ChatAssistantContainer} and {@link ChatAssistantButton}. Render it directly
 * only for a layout of your own.
 */
export const [ChatAssistantView, chatAssistantView] = hoistCmp.withFactory<ChatAssistantViewProps>({
    displayName: 'ChatAssistantView',
    model: uses(ChatAssistantModel),
    className: 'xh-chat-helper',

    render({model, className, assistantIcon, placeholder, testId}, ref) {
        const impl = useLocalModel(ChatAssistantViewLocalModel),
            {chatModel, title} = model;
        impl.assistant = model;
        if (!chatModel) return null;
        installChatAssistantRenderers(model);

        const icon = () => assistantIcon ?? ChatKit.defaults.assistantIcon(),
            {composerModel} = chatModel;
        return useHotkeys(
            div({
                ref: impl.rootRef,
                className: classNames(className, 'xh-chat--compact', {
                    'xh-chat-helper--popover': model.mode === 'popover',
                    'xh-chat-helper--empty': chatModel.isEmpty
                }),
                role: 'complementary',
                'aria-label': `Assistant for ${title}`,
                items: [
                    div({
                        className: 'xh-chat-helper__header',
                        items: [
                            span({className: 'xh-chat-helper__icon', item: icon()}),
                            span({className: 'xh-chat-helper__title', item: title}),
                            button({
                                icon: Icon.x(),
                                minimal: true,
                                tooltip: 'Close assistant',
                                'aria-label': 'Close assistant',
                                onClick: () => model.close()
                            })
                        ]
                    }),
                    chatMessageList({
                        model: chatModel,
                        className: 'xh-chat-helper__messages',
                        assistantIcon: icon(),
                        testId: getTestId(testId, 'messages'),
                        emptyState: div({
                            className: 'xh-chat-helper__empty',
                            items: [
                                div({className: 'xh-chat-helper__intro', item: model.intro}),
                                chatSuggestions({model: chatModel, suggestions: model.suggestions})
                            ]
                        })
                    }),
                    div({
                        className: 'xh-chat-helper__bottom',
                        items: [
                            chatStatusRegion({model: composerModel}),
                            chatDataBoundaryLine({boundary: model.boundary}),
                            chatComposer({
                                model: composerModel,
                                className: 'xh-chat-helper__composer',
                                placeholder:
                                    placeholder ?? `Ask about ${title}, or tell it what to change…`,
                                testId: getTestId(testId, 'composer'),
                                leftItems: button({
                                    icon: Icon.reset(),
                                    minimal: true,
                                    tooltip: 'Start over',
                                    'aria-label': 'Start over',
                                    disabled: chatModel.isEmpty,
                                    onClick: () => model.startOver()
                                })
                            })
                        ]
                    })
                ]
            }),
            impl.hotkeys
        );
    }
});

//------------------
// Implementation
//------------------
class ChatAssistantViewLocalModel extends HoistModel {
    override xhImpl = true;

    readonly rootRef = createObservableRef<HTMLDivElement>();

    // Where focus was before the helper opened, to return to when it closes.
    private returnFocusEl: HTMLElement = null;

    /** The helper - set in render. */
    assistant: ChatAssistantModel = null;

    /** Ctrl/Cmd+I closes the helper from inside it. The component's own binding opens it. */
    get hotkeys() {
        return [
            ...getChatHotkeys({
                openHelper: () => this.assistant.close(),
                focusComposer: () => this.assistant.chatModel?.composerModel.focus()
            }),
            {
                combo: 'esc',
                label: 'Stop the reply, or close the assistant',
                group: 'Chat',
                allowInInput: true,
                onKeyDown: this.onEscape
            }
        ];
    }

    override onLinked() {
        // Linked in the first render, before the helper takes focus.
        const active = document.activeElement;
        this.returnFocusEl =
            active instanceof HTMLElement && active !== document.body ? active : null;

        // Focus lands once the helper has rendered: on a waiting approval, else the composer.
        this.addReaction({
            track: () => this.rootRef.current,
            run: root => {
                if (!root || !this.assistant) return;
                const approval = root.querySelector<HTMLElement>(
                    '.xh-chat-tool-call__approval-bar button:not([disabled])'
                );
                if (this.assistant.chatModel?.isAwaitingUser && approval) {
                    approval.focus();
                } else {
                    this.assistant.chatModel?.composerModel.focus();
                }
            }
        });
    }

    override destroy() {
        // Focus left with the helper's content, so return it - unless the user moved it on.
        const active = document.activeElement;
        if (!active || active === document.body) {
            const target = this.returnFocusEl?.isConnected
                ? this.returnFocusEl
                : this.assistant?.buttonRef.current;
            target?.focus();
        }
        super.destroy();
    }

    /** Escape: a popup closes first (it stops the key), then a running reply, then the helper. */
    onEscape = (e: globalThis.KeyboardEvent) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        const {assistant} = this;
        if (assistant.chatModel?.isBusy) {
            assistant.chatModel.stop();
        } else {
            assistant.close();
        }
    };
}
