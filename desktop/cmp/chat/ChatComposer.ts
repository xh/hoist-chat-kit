import {castArray, isString} from 'lodash';
import {type ReactNode, useLayoutEffect} from 'react';
import {div, input, span, vbox} from '@xh/hoist/cmp/layout';
import {type BoxProps, hoistCmp, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button, type ButtonProps} from '@xh/hoist/desktop/cmp/button';
import {textArea} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {throwIf, withDefault} from '@xh/hoist/utils/js';
import {useOnResize} from '@xh/hoist/utils/react';
import {ChatComposerModel} from '../../../core';
import '../../../styles/vars.scss';
import './ChatComposer.scss';
import {chatFileChip} from './ChatFileChip';
import {chatAnnouncerRegions} from './impl/ChatAnnouncerRegions';
import {ChatComposerLocalModel} from './impl/ChatComposerLocalModel';
import {classNames} from '../../../impl/ClassNames';

/** Props for {@link ChatComposer}. */
export interface ChatComposerProps extends HoistProps<ChatComposerModel>, BoxProps {
    /** Items shown above the input, inside the composer - such as context chips or a notice. */
    topItems?: ReactNode;

    /**
     * Items that lead the input row, before the text - such as a brand mark. They sit level with
     * the first line as the input grows. To animate one while a reply runs, style it under the
     * composer's `xh-chat-composer--busy` class.
     */
    startItems?: ReactNode;

    /**
     * Items for the left slot of the composer's bar - pills such as a {@link ChatComposerPill}
     * for an agent or tools, or a {@link ChatScopeChip} for a document scope.
     */
    leftItems?: ReactNode;

    /**
     * Items for the right slot of the composer's bar, before the attach and send buttons - such
     * as a context meter.
     */
    rightItems?: ReactNode;

    /**
     * Prompt shown in the empty input. Default 'Send a message...', or, while the reply waits
     * for the user, 'Or tell the assistant what to do instead...'.
     */
    placeholder?: string;

    /** Rows the input grows to before it scrolls. Default 8. */
    maxRows?: number;

    /** True to focus the input when the composer mounts. */
    autoFocus?: boolean;

    /**
     * How the Send button looks - for example `{icon: Icon.arrowRight()}`, or a `text` label. For
     * an icon Hoist does not name, register it with `Icon.register()` and pass what it returns.
     * The composer keeps what it does: when it is enabled, its tooltip with the reason it is not,
     * and the swap to Stop. Default a primary button with an up arrow.
     */
    sendButtonProps?: ChatComposerButtonProps;

    /** How the Stop button looks, as `sendButtonProps` for Send. Default outlined, with "Stop". */
    stopButtonProps?: ChatComposerButtonProps;

    /**
     * Where the bar of pills, attach and Send goes. `stacked` puts it in a row under the input.
     * `inline` puts it after the input, in the input's row, for a one-row composer. Default
     * 'stacked'.
     */
    layout?: 'stacked' | 'inline';
}

/**
 * The look of a composer button - the props of a Hoist `Button` that change only how it looks. A
 * `className` adds to the kit's own. A `text` label also names the button for screen readers.
 */
export type ChatComposerButtonProps = Pick<
    ButtonProps,
    'icon' | 'text' | 'intent' | 'minimal' | 'outlined' | 'className'
>;

/**
 * The input for writing a message: one box, with an optional tray of attachments, an
 * auto-growing text area with any start items before it, and a bar with pills on the left and the
 * attach and send buttons on the right. Enter sends and Shift+Enter starts a new line. Up arrow
 * in an empty input recalls the last message. While a reply is in progress, Send becomes a Stop
 * button, and Escape stops too - if the composer's host is a `ChatModel`. The input stays
 * editable, and Enter does nothing until the reply ends.
 *
 * Send is disabled while the draft is empty, and for a reason - the host's `sendBlockedReason`,
 * the browser being offline, or a wait before a retry. A reason shows as the button's tooltip and
 * its accessible description, on a focusable wrapper so that keyboard users reach it. Render a
 * {@link ChatStatusRegion} above the composer to state the reason, with its fix.
 *
 * When the model enables attachments, files can be added with the attach button, by pasting, or
 * by dropping them on the composer. They show as chips above the input until sent. Files left out
 * - of the wrong type, too large, or over the limit - are named under the chips, and read once to
 * screen readers.
 *
 * The composer renders the hidden live regions of `chatAnnouncer`, as the message list does, so
 * that a layout with no list still speaks to screen readers.
 *
 * Uses a {@link ChatComposerModel} from props, or else the `composerModel` of the `ChatModel` in
 * context. A composer model over an app's own {@link ChatComposerHost} needs no `ChatModel`.
 */
export const [ChatComposer, chatComposer] = hoistCmp.withFactory<ChatComposerProps>({
    displayName: 'ChatComposer',
    model: uses(ChatComposerModel, {optional: true}),
    className: 'xh-chat-composer',

    render(
        {
            className,
            model,
            topItems,
            startItems,
            leftItems,
            rightItems,
            placeholder,
            maxRows,
            autoFocus,
            sendButtonProps,
            stopButtonProps,
            layout = 'stacked',
            ...rest
        },
        ref
    ) {
        const impl = useLocalModel(ChatComposerLocalModel),
            {composerModel} = impl,
            boxRef = useOnResize(impl.fitInput),
            toolbarRef = useOnResize(impl.fitInput);

        throwIf(!composerModel, 'ChatComposer requires a ChatComposerModel or a ChatModel.');

        const {text, attachments, attachmentErrors, enableAttachments, inputRef, host, chatModel} =
                composerModel,
            isPaused = chatModel?.lastMessage?.status === 'paused',
            isInline = layout === 'inline';
        useLayoutEffect(() => impl.fitInput(), [impl, text, maxRows]);

        const toolbar = div({
            // Inline, the bar's width sets the input's, as when Stop takes Send's place.
            ref: toolbarRef,
            className: 'xh-chat-composer__toolbar',
            items: [
                div({
                    className: 'xh-chat-composer__left',
                    items: castArray(leftItems)
                }),
                div({
                    className: 'xh-chat-composer__right',
                    items: [
                        ...castArray(rightItems),
                        ...(enableAttachments ? attachButton(composerModel, impl) : []),
                        ...sendButton(composerModel, impl, sendButtonProps, stopButtonProps)
                    ]
                })
            ]
        });

        return vbox({
            ref,
            className: classNames(className, {
                'xh-chat-composer--inline': isInline,
                'xh-chat-composer--dragging': impl.isDragging,
                'xh-chat-composer--busy': host.isBusy,
                'xh-chat-composer--attention': isPaused,
                'xh-chat-composer--waiting': !!composerModel.retryWait
            }),
            // Room for the focus ring of the box, which a Box would otherwise clip.
            overflow: 'visible',
            ...rest,
            onPaste: impl.onPaste,
            onDragEnter: impl.onDragEnter,
            onDragOver: impl.onDragOver,
            onDragLeave: impl.onDragLeave,
            onDrop: impl.onDrop,
            items: [
                topItems ? div({className: 'xh-chat-composer__top', items: topItems}) : null,
                div({
                    ref: boxRef,
                    className: 'xh-chat-composer__box',
                    items: [
                        attachments.length
                            ? div({
                                  className: 'xh-chat-composer__attachments',
                                  items: attachments.map(file =>
                                      chatFileChip({
                                          key: file.id,
                                          file,
                                          onRemove: () => composerModel.removeAttachment(file.id)
                                      })
                                  )
                              })
                            : null,
                        attachmentErrors.length ? attachmentErrorRow(composerModel) : null,
                        inputRow(
                            startItems,
                            isInline ? toolbar : null,
                            textArea({
                                className: 'xh-chat-composer__input',
                                model: composerModel,
                                bind: 'text',
                                commitOnChange: true,
                                spellCheck: true,
                                autoFocus,
                                width: null,
                                height: null,
                                placeholder: withDefault(
                                    placeholder,
                                    isPaused
                                        ? 'Or tell the assistant what to do instead...'
                                        : 'Send a message...'
                                ),
                                domAttrs: {'aria-label': 'Message'},
                                ref: inputRef,
                                onKeyDown: impl.onKeyDown
                            })
                        ),
                        isInline ? null : toolbar
                    ]
                }),
                impl.isDragging
                    ? div({
                          className: 'xh-chat-composer__drop-hint',
                          items: [Icon.paperclip(), 'Drop files to attach']
                      })
                    : null,
                chatAnnouncerRegions()
            ]
        });
    }
});

//------------------
// Implementation
//------------------
/** The input, in a row with any start items before it and an inline bar after it. */
function inputRow(startItems: ReactNode, inlineBar: ReactNode, input: ReactNode): ReactNode {
    const items = castArray(startItems).filter(it => it != null && it !== false);
    if (!items.length && !inlineBar) return input;
    return div({
        className: 'xh-chat-composer__input-row',
        items: [
            items.length ? div({className: 'xh-chat-composer__start', items}) : null,
            input,
            inlineBar
        ]
    });
}

function attachButton(composerModel: ChatComposerModel, impl: ChatComposerLocalModel): ReactNode[] {
    const {accept, maxFiles} = composerModel;
    return [
        button({
            key: 'attach',
            className: 'xh-chat-composer__attach',
            icon: Icon.paperclip(),
            tooltip: 'Attach files',
            'aria-label': 'Attach files',
            onClick: () => impl.fileInputRef.current?.click()
        }),
        // The browser's file dialog opens only from a file input - kept hidden behind the button.
        input({
            key: 'fileInput',
            ref: impl.fileInputRef,
            type: 'file',
            className: 'xh-chat-composer__file-input',
            multiple: maxFiles !== 1,
            accept: accept?.join(','),
            tabIndex: -1,
            onChange: e => impl.onFilesChosen(e.target)
        })
    ];
}

function attachmentErrorRow(composerModel: ChatComposerModel): ReactNode {
    return div({
        className: 'xh-chat-composer__attachment-errors',
        items: [
            Icon.warning(),
            div({
                className: 'xh-chat-composer__attachment-errors-text',
                item: composerModel.attachmentErrors.join(' ')
            }),
            button({
                icon: Icon.x(),
                tooltip: 'Dismiss',
                'aria-label': 'Dismiss',
                onClick: () => composerModel.clearAttachmentErrors()
            })
        ]
    });
}

// Stop takes Send's place while busy, named with its word at every width. A reason Send is
// disabled shows as its tooltip, and in an element that describes it for assistive technology.
// A disabled button cannot take focus, so a focusable wrapper carries both to keyboard users.
function sendButton(
    composerModel: ChatComposerModel,
    impl: ChatComposerLocalModel,
    sendProps: ChatComposerButtonProps = {},
    stopProps: ChatComposerButtonProps = {}
): ReactNode[] {
    const {chatModel, canSend} = composerModel,
        reason = composerModel.sendDisabledReason,
        reasonId = `${impl.xhId}-send-reason`;

    if (chatModel?.isBusy) {
        const stopName = labelOf(stopProps.text, 'Stop');
        return [
            button({
                key: 'stop',
                icon: Icon.stop({prefix: 'fas'}),
                text: 'Stop',
                outlined: true,
                ...stopProps,
                className: classNames('xh-chat-composer__stop', stopProps.className),
                'aria-label': stopName,
                onClick: () => {
                    chatModel.stop();
                    composerModel.focus();
                }
            })
        ];
    }

    const sendName = labelOf(sendProps.text, 'Send'),
        send = button({
            icon: Icon.arrowUp(),
            intent: 'primary',
            minimal: false,
            ...sendProps,
            className: classNames('xh-chat-composer__send', sendProps.className),
            tooltip: reason ?? sendName,
            'aria-label': sendName,
            'aria-describedby': reason ? reasonId : undefined,
            disabled: !canSend,
            onClick: () => {
                composerModel.focus();
                composerModel.submitAsync().catchDefault();
            }
        });
    return [
        div({
            key: 'reason',
            id: reasonId,
            className: 'xh-chat-composer__send-reason',
            item: reason
        }),
        reason
            ? span({
                  key: 'send',
                  className: 'xh-chat-composer__send-wrap',
                  tabIndex: 0,
                  title: reason,
                  'aria-describedby': reasonId,
                  item: send
              })
            : span({key: 'send', className: 'xh-chat-composer__send-wrap', item: send})
    ];
}

/** A button's accessible name: its text label, if it is a string, else the default. */
function labelOf(text: ReactNode, defaultName: string): string {
    return isString(text) && text ? text : defaultName;
}
