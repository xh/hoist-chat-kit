import {castArray} from 'lodash';
import {type ReactNode, useLayoutEffect} from 'react';
import {div, input, vbox} from '@xh/hoist/cmp/layout';
import {type BoxProps, hoistCmp, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textArea} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {throwIf, withDefault} from '@xh/hoist/utils/js';
import {useOnResize} from '@xh/hoist/utils/react';
import {ChatComposerModel} from '../../../core';
import '../../../styles/vars.scss';
import './ChatComposer.scss';
import {chatFileChip} from './ChatFileChip';
import {ChatComposerLocalModel} from './impl/ChatComposerLocalModel';
import {classNames} from '../../../impl/ClassNames';

/** Props for {@link ChatComposer}. */
export interface ChatComposerProps extends HoistProps<ChatComposerModel>, BoxProps {
    /** Items shown above the input, inside the composer - such as context chips or a notice. */
    topItems?: ReactNode;

    /** Items for the composer's toolbar, to the left - such as a model picker or tool toggles. */
    leftItems?: ReactNode;

    /** Items for the composer's toolbar, to the right, before the send button. */
    rightItems?: ReactNode;

    /** Prompt shown in the empty input. Default 'Send a message...'. */
    placeholder?: string;

    /** Rows the input grows to before it scrolls. Default 10. */
    maxRows?: number;

    /** True to focus the input when the composer mounts. */
    autoFocus?: boolean;
}

/**
 * The input for writing a message: an auto-growing text area with a send button, inside a rounded
 * card. Enter sends and Shift+Enter starts a new line. Up arrow in an empty input recalls the last
 * message. While a reply streams, the send button becomes a stop button, and Escape stops it too -
 * if the composer's host can stop.
 *
 * While the host gives a reason to wait, such as the chat's `sendBlocker`, the send button is
 * disabled, with the reason as its tooltip and its accessible description.
 *
 * When the model enables attachments, files can be added with the attach button, by pasting, or
 * by dropping them on the composer. They show as chips above the input until sent. Files left out
 * - of the wrong type, too large, or over the limit - are named under the chips.
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
            leftItems,
            rightItems,
            placeholder,
            maxRows,
            autoFocus,
            ...rest
        },
        ref
    ) {
        const impl = useLocalModel(ChatComposerLocalModel),
            {composerModel} = impl,
            boxRef = useOnResize(impl.fitInput);

        throwIf(!composerModel, 'ChatComposer requires a ChatComposerModel or a ChatModel.');

        const {text, attachments, attachmentErrors, enableAttachments, inputRef} = composerModel;
        useLayoutEffect(() => impl.fitInput(), [impl, text, maxRows]);

        return vbox({
            ref,
            className: classNames(className, {'xh-chat-composer--dragging': impl.isDragging}),
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
                        textArea({
                            className: 'xh-chat-composer__input',
                            model: composerModel,
                            bind: 'text',
                            commitOnChange: true,
                            spellCheck: true,
                            autoFocus,
                            width: null,
                            height: null,
                            placeholder: withDefault(placeholder, 'Send a message...'),
                            domAttrs: {'aria-label': 'Message'},
                            ref: inputRef,
                            onKeyDown: impl.onKeyDown
                        }),
                        div({
                            className: 'xh-chat-composer__toolbar',
                            items: [
                                ...(enableAttachments ? attachButton(composerModel, impl) : []),
                                ...castArray(leftItems),
                                div({className: 'xh-chat-composer__spacer'}),
                                ...castArray(rightItems),
                                ...sendButton(composerModel, impl)
                            ]
                        })
                    ]
                }),
                impl.isDragging
                    ? div({
                          className: 'xh-chat-composer__drop-hint',
                          items: [Icon.paperclip(), 'Drop files to attach']
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
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
        role: 'alert',
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

// A send blocker's reason shows as the disabled button's tooltip, and in a status element that
// describes the button for assistive technology.
function sendButton(composerModel: ChatComposerModel, impl: ChatComposerLocalModel): ReactNode[] {
    const {host, canSend} = composerModel,
        sendBlockedReason = host.sendBlockedReason ?? null,
        reasonId = `${impl.xhId}-send-reason`;

    if (host.isBusy && host.stop) {
        return [
            button({
                key: 'stop',
                className: 'xh-chat-composer__send xh-chat-composer__send--stop',
                icon: Icon.stop({prefix: 'fas'}),
                tooltip: 'Stop',
                'aria-label': 'Stop',
                minimal: false,
                onClick: () => host.stop()
            })
        ];
    }
    return [
        div({
            key: 'reason',
            id: reasonId,
            className: 'xh-chat-composer__send-reason',
            role: 'status',
            item: sendBlockedReason
        }),
        button({
            key: 'send',
            className: 'xh-chat-composer__send',
            icon: Icon.arrowUp(),
            tooltip: sendBlockedReason ?? 'Send',
            'aria-label': 'Send',
            'aria-describedby': sendBlockedReason ? reasonId : undefined,
            minimal: false,
            disabled: !canSend,
            onClick: () => {
                composerModel.focus();
                composerModel.submitAsync().catchDefault();
            }
        })
    ];
}
