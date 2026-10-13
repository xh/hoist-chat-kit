import {castArray} from 'lodash';
import {type ClipboardEvent, type DragEvent, type ReactNode, useLayoutEffect} from 'react';
import {div, input} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    type LayoutProps,
    type TestSupportProps,
    useContextModel,
    useLocalModel,
    uses
} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textArea} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {TEST_ID, throwIf} from '@xh/hoist/utils/js';
import {createObservableRef, getLayoutProps, useOnResize} from '@xh/hoist/utils/react';
import {ChatComposerModel, ChatModel} from '../../../core';
import '../../../styles/vars.scss';
import './ChatComposer.scss';
import {chatFileChip} from './ChatFileChip';
import {fitTextAreaToContent, isImeComposing} from './impl/AutoGrow';

export interface ChatComposerProps
    extends HoistProps<ChatComposerModel>, LayoutProps, TestSupportProps {
    /** Items shown above the input, inside the composer - such as context chips or a notice. */
    topItems?: ReactNode;

    /** Items for the composer's toolbar, to the left - such as a model picker or tool toggles. */
    leftItems?: ReactNode;

    /** Items for the composer's toolbar, to the right, before the send button. */
    rightItems?: ReactNode;

    /** Prompt shown in the empty input. Defaults to the model's `placeholder`. */
    placeholder?: string;

    /** True to focus the input when the composer mounts. */
    autoFocus?: boolean;
}

/**
 * The input for writing a message: an auto-growing text area with a send button, inside a rounded
 * card. Enter sends and Shift+Enter starts a new line. Up arrow in an empty input recalls the last
 * message. While a reply streams, the send button becomes a stop button.
 *
 * When the model enables attachments, files can be added with the attach button, by pasting, or
 * by dropping them on the composer. They show as chips above the input until sent.
 *
 * Uses a {@link ChatComposerModel} from props, or else the `composerModel` of the
 * {@link ChatModel} in context.
 */
export const [ChatComposer, chatComposer] = hoistCmp.withFactory<ChatComposerProps>({
    displayName: 'ChatComposer',
    model: uses(ChatComposerModel, {optional: true}),
    className: 'xh-chat-composer',

    render({
        className,
        model,
        topItems,
        leftItems,
        rightItems,
        placeholder,
        autoFocus,
        testId,
        ...rest
    }) {
        const chatModel = useContextModel(ChatModel),
            composerModel = model ?? chatModel?.composerModel,
            impl = useLocalModel(ChatComposerLocalModel);

        throwIf(!composerModel, 'ChatComposer requires a ChatComposerModel or a ChatModel.');

        const {text, attachments, enableAttachments, maxRows, inputRef} = composerModel,
            fitInput = () => {
                fitTextAreaToContent(inputRef.current?.inputEl, maxRows);
            },
            boxRef = useOnResize(fitInput);

        useLayoutEffect(fitInput, [text, maxRows, inputRef]);

        const classes = [className];
        if (impl.isDragging) classes.push('xh-chat-composer--dragging');

        return div({
            className: classes.join(' '),
            style: getLayoutProps(rest),
            [TEST_ID]: testId,
            onPaste: enableAttachments ? e => impl.onPaste(e, composerModel) : undefined,
            onDragEnter: enableAttachments ? e => impl.onDragEnter(e) : undefined,
            onDragOver: enableAttachments ? e => impl.onDragOver(e) : undefined,
            onDragLeave: enableAttachments ? e => impl.onDragLeave(e) : undefined,
            onDrop: enableAttachments ? e => impl.onDrop(e, composerModel) : undefined,
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
                        textArea({
                            className: 'xh-chat-composer__input',
                            model: composerModel,
                            bind: 'text',
                            commitOnChange: true,
                            spellCheck: true,
                            autoFocus,
                            width: null,
                            height: null,
                            placeholder: placeholder ?? composerModel.placeholder,
                            ref: inputRef,
                            onKeyDown: e => impl.onKeyDown(e, composerModel)
                        }),
                        div({
                            className: 'xh-chat-composer__toolbar',
                            items: [
                                ...(enableAttachments ? attachButton(composerModel, impl) : []),
                                ...castArray(leftItems),
                                div({className: 'xh-chat-composer__spacer'}),
                                ...castArray(rightItems),
                                sendButton(composerModel)
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
class ChatComposerLocalModel extends HoistModel {
    override xhImpl = true;

    @observable accessor isDragging = false;

    fileInputRef = createObservableRef<HTMLInputElement>();

    // Drag events fire on every child crossed, so count entries to know when the drag has left.
    private dragDepth = 0;

    onKeyDown(e: KeyboardEvent, composerModel: ChatComposerModel) {
        if (isImeComposing(e)) return;

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (composerModel.canSend) composerModel.submitAsync().catchDefault();
        } else if (e.key === 'ArrowUp' && !composerModel.text) {
            e.preventDefault();
            composerModel.recallLastMessage();
        }
    }

    onPaste(e: ClipboardEvent, composerModel: ChatComposerModel) {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (!files.length) return;
        e.preventDefault();
        composerModel.addFilesAsync(files).catchDefault();
    }

    onDragEnter(e: DragEvent) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        this.dragDepth++;
        this.setDragging(true);
    }

    onDragOver(e: DragEvent) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }

    onDragLeave(e: DragEvent) {
        if (!hasFiles(e)) return;
        this.dragDepth = Math.max(0, this.dragDepth - 1);
        if (!this.dragDepth) this.setDragging(false);
    }

    onDrop(e: DragEvent, composerModel: ChatComposerModel) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        this.dragDepth = 0;
        this.setDragging(false);
        composerModel.addFilesAsync(Array.from(e.dataTransfer.files)).catchDefault();
    }

    onFilesChosen(fileInput: HTMLInputElement, composerModel: ChatComposerModel) {
        const files = Array.from(fileInput.files ?? []);
        fileInput.value = ''; // Allow the same file to be chosen again.
        if (files.length) composerModel.addFilesAsync(files).catchDefault();
    }

    @action
    private setDragging(isDragging: boolean) {
        this.isDragging = isDragging;
    }
}

function hasFiles(e: DragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

function attachButton(composerModel: ChatComposerModel, impl: ChatComposerLocalModel): ReactNode[] {
    const {accept, maxFiles} = composerModel;
    return [
        button({
            key: 'attach',
            className: 'xh-chat-composer__attach',
            icon: Icon.paperclip(),
            tooltip: 'Attach files',
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
            onChange: e => impl.onFilesChosen(e.target, composerModel)
        })
    ];
}

function sendButton(composerModel: ChatComposerModel): ReactNode {
    const {chatModel, canSend} = composerModel;
    return chatModel.isBusy
        ? button({
              className: 'xh-chat-composer__send xh-chat-composer__send--stop',
              icon: Icon.stop({prefix: 'fas'}),
              tooltip: 'Stop',
              minimal: false,
              onClick: () => chatModel.stop()
          })
        : button({
              className: 'xh-chat-composer__send',
              icon: Icon.arrowUp(),
              tooltip: 'Send',
              intent: 'primary',
              minimal: false,
              disabled: !canSend,
              onClick: () => {
                  composerModel.focus();
                  composerModel.submitAsync().catchDefault();
              }
          });
}
