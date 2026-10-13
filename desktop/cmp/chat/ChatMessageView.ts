import {last} from 'lodash';
import {type ReactElement, type ReactNode, useLayoutEffect, useMemo} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textArea} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, bindable, observable} from '@xh/hoist/mobx';
import {createObservableRef} from '@xh/hoist/utils/react';
import {type ChatMarkdownComponents, chatMarkdown} from '../../../cmp/markdown';
import {
    type ChatCitation,
    type ChatDataPart,
    type ChatFilePart,
    type ChatMessage,
    type ChatModel,
    type ChatPart,
    type ChatSourcePart,
    isToolCallFinal
} from '../../../core';
import '../../../styles/vars.scss';
import {chatFileChip} from './ChatFileChip';
import './ChatMessageView.scss';
import {chatReasoning} from './ChatReasoning';
import {chatCitations, chatSources} from './ChatSources';
import {chatToolCall} from './ChatToolCall';
import {chatTypingIndicator} from './ChatTypingIndicator';
import {fitTextAreaToContent, isImeComposing} from './impl/AutoGrow';
import {chatCopyButton} from './impl/ChatCopyButton';
import {formatElapsed} from './impl/ChatFormat';
import {jsonView} from './impl/JsonView';
import {CHAT_MARKDOWN_COMPONENTS} from './impl/MarkdownComponents';

export interface ChatMessageViewProps extends HoistProps {
    /** The message to show. */
    message: ChatMessage;

    /** The conversation holding the message - for its tools, renderers and actions. */
    chatModel: ChatModel;

    /**
     * True if this is the last message in the conversation. Its actions stay visible, and an
     * assistant message offers Regenerate.
     */
    isLast?: boolean;

    /** Name shown on assistant messages. Default 'Assistant'. */
    assistantName?: string;

    /** Icon shown on assistant messages. Default a sparkles icon. */
    assistantIcon?: ReactElement;

    /**
     * Components to render in place of standard markdown elements, merged over the defaults
     * (which render code blocks with a {@link ChatCodeBlock}). Pass a stable object.
     */
    markdownComponents?: ChatMarkdownComponents;

    /**
     * True to show a user message in edit mode. Pair with `onEditingChange` to control editing
     * from outside - left unset, the view manages its own edit state.
     */
    isEditing?: boolean;

    /** Called when the user starts or ends editing a user message. */
    onEditingChange?: (message: ChatMessage, isEditing: boolean) => void;
}

/**
 * One message in a conversation.
 *
 * User messages show as a right-aligned bubble of plain text, with any attached files above it.
 * Assistant messages span the full width with no bubble, under a header with the assistant's name
 * and the time taken. Their parts render in order: markdown text, reasoning, tool calls, files and
 * app-rendered data, followed by the sources consulted.
 *
 * An action bar shows on hover: Copy on every message, Edit on user messages, and Regenerate on
 * the last assistant message. System messages show as a centered note.
 */
export const [ChatMessageView, chatMessageView] = hoistCmp.withFactory<ChatMessageViewProps>({
    displayName: 'ChatMessageView',
    model: false,
    className: 'xh-chat-message',

    render(props) {
        const {className, message, isLast = false} = props,
            impl = useLocalModel(ChatMessageViewLocalModel),
            modifiers = [`xh-chat-message--${message.role}`];

        if (message.isStreaming) modifiers.push('xh-chat-message--streaming');
        if (isLast) modifiers.push('xh-chat-message--last');
        if (impl.isEditing) modifiers.push('xh-chat-message--editing');

        return div({
            className: [className, ...modifiers].join(' '),
            items: message.isUser
                ? userContent(props, impl)
                : message.role === 'system'
                  ? div({className: 'xh-chat-message__system', item: message.text})
                  : assistantContent(props)
        });
    }
});

//------------------
// Implementation
//------------------
type ViewProps = ChatMessageViewProps;

class ChatMessageViewLocalModel extends HoistModel {
    override xhImpl = true;

    @bindable accessor draft: string = '';
    @observable accessor localEditing = false;

    inputRef = createObservableRef<HTMLInputElement>();

    get props(): ViewProps {
        return this.componentProps as ViewProps;
    }

    get isEditing(): boolean {
        const {isEditing, onEditingChange} = this.props;
        return onEditingChange ? !!isEditing : this.localEditing;
    }

    override onLinked() {
        // Editing may start from outside the view - e.g. the list's error banner - so seed the
        // draft whenever it starts.
        this.addReaction({
            track: () => this.isEditing,
            run: isEditing => {
                if (isEditing) this.draft = this.props.message.text;
            },
            fireImmediately: true
        });
    }

    startEdit() {
        this.setEditing(true);
    }

    cancelEdit() {
        this.setEditing(false);
    }

    submitEdit() {
        const {message, chatModel} = this.props,
            text = this.draft.trim();
        if (!text || chatModel.isBusy) return;
        this.setEditing(false);
        chatModel.editMessageAsync(message.id, text).catchDefault();
    }

    onEditKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.cancelEdit();
        } else if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) {
            e.preventDefault();
            this.submitEdit();
        }
    };

    @action
    private setEditing(isEditing: boolean) {
        const {message, onEditingChange} = this.props;
        if (onEditingChange) {
            onEditingChange(message, isEditing);
        } else {
            this.localEditing = isEditing;
        }
    }
}

//------------------------
// User messages
//------------------------
function userContent(props: ViewProps, impl: ChatMessageViewLocalModel): ReactNode[] {
    const {message} = props,
        files = message.parts.filter(it => it.type === 'file') as ChatFilePart[];

    return [
        files.length ? fileRow(files) : null,
        impl.isEditing
            ? editBox({impl, chatModel: props.chatModel})
            : div({className: 'xh-chat-message__bubble', item: message.text}),
        impl.isEditing
            ? null
            : messageActions({message, chatModel: props.chatModel, isLast: props.isLast, impl})
    ];
}

interface EditBoxProps extends HoistProps {
    impl: ChatMessageViewLocalModel;
    chatModel: ChatModel;
}

const editBox = hoistCmp.factory<EditBoxProps>({
    displayName: 'ChatMessageEditBox',
    model: false,

    render({impl, chatModel}) {
        const {draft, inputRef} = impl;

        useLayoutEffect(() => fitTextAreaToContent(inputRef.current, 12), [draft, inputRef]);

        return div({
            className: 'xh-chat-message__edit',
            items: [
                textArea({
                    model: impl,
                    bind: 'draft',
                    commitOnChange: true,
                    autoFocus: true,
                    spellCheck: true,
                    width: null,
                    height: null,
                    inputRef,
                    onKeyDown: impl.onEditKeyDown
                }),
                div({
                    className: 'xh-chat-message__edit-actions',
                    items: [
                        button({text: 'Cancel', onClick: () => impl.cancelEdit()}),
                        button({
                            text: 'Send',
                            intent: 'primary',
                            minimal: false,
                            disabled: !draft.trim() || chatModel.isBusy,
                            onClick: () => impl.submitEdit()
                        })
                    ]
                })
            ]
        });
    }
});

//------------------------
// Assistant messages
//------------------------
function assistantContent(props: ViewProps): ReactNode[] {
    const {message} = props,
        sources = message.parts.filter(it => it.type === 'source') as ChatSourcePart[];

    return [
        messageHeader(props),
        div({
            className: 'xh-chat-message__body',
            items: [
                ...groupParts(message.parts).map(group => renderPartGroup(group, props, sources)),
                isAwaitingContent(message) ? chatTypingIndicator({key: 'typing'}) : null,
                statusNote(props)
            ]
        }),
        sources.length ? chatSources({sources}) : null,
        message.isStreaming
            ? null
            : messageActions({
                  message,
                  chatModel: props.chatModel,
                  isLast: props.isLast,
                  impl: null
              })
    ];
}

function messageHeader({message, assistantName, assistantIcon}: ViewProps): ReactNode {
    const elapsed = message.isStreaming ? null : formatElapsed(message.metadata?.elapsedMs);
    return div({
        className: 'xh-chat-message__header',
        items: [
            span({className: 'xh-chat-message__avatar', item: assistantIcon ?? Icon.ai()}),
            span({className: 'xh-chat-message__name', item: assistantName ?? 'Assistant'}),
            elapsed
                ? span({
                      className: 'xh-chat-message__elapsed',
                      title: 'Time taken',
                      item: elapsed
                  })
                : null
        ]
    });
}

// Consecutive files render together as one row of chips. Sources render after the body.
type PartGroup = ChatPart | ChatFilePart[];

function groupParts(parts: ChatPart[]): PartGroup[] {
    const ret: PartGroup[] = [];
    parts.forEach(part => {
        if (part.type === 'source') return;
        const prev = last(ret);
        if (part.type === 'file' && Array.isArray(prev)) {
            prev.push(part);
        } else {
            ret.push(part.type === 'file' ? [part] : part);
        }
    });
    return ret;
}

function renderPartGroup(group: PartGroup, props: ViewProps, sources: ChatSourcePart[]) {
    if (Array.isArray(group)) return fileRow(group);

    const {message, chatModel} = props;
    switch (group.type) {
        case 'text':
            return textPart({
                key: group.id,
                text: group.text,
                isStreaming: group.state === 'streaming',
                citations: group.citations,
                // Only cited text needs the sources - passing them otherwise defeats memoization.
                sources: group.citations?.length ? sources : null,
                markdownComponents: props.markdownComponents
            });
        case 'reasoning':
            return chatReasoning({key: group.id, part: group});
        case 'toolCall':
            return chatToolCall({key: group.id, part: group, message, chatModel});
        case 'data':
            return dataPart({key: group.id, part: group, message, chatModel});
        default:
            return null;
    }
}

interface TextPartProps extends HoistProps {
    text: string;
    isStreaming: boolean;
    citations: ChatCitation[];
    sources: ChatSourcePart[];
    markdownComponents: ChatMarkdownComponents;
}

const textPart = hoistCmp.factory<TextPartProps>({
    displayName: 'ChatTextPart',
    model: false,

    render({text, isStreaming, citations, sources, markdownComponents}) {
        const components = useMemo(
            () =>
                markdownComponents
                    ? {...CHAT_MARKDOWN_COMPONENTS, ...markdownComponents}
                    : CHAT_MARKDOWN_COMPONENTS,
            [markdownComponents]
        );

        return div({
            className: 'xh-chat-message__text',
            items: [
                chatMarkdown({content: text, isStreaming, components}),
                citations?.length ? chatCitations({citations, sources}) : null
            ]
        });
    }
});

interface DataPartProps extends HoistProps {
    part: ChatDataPart;
    message: ChatMessage;
    chatModel: ChatModel;
}

const dataPart = hoistCmp.factory<DataPartProps>({
    displayName: 'ChatDataPart',
    model: false,

    render({part, message, chatModel}) {
        const renderer = chatModel.dataRenderers?.[part.dataType];
        if (renderer) {
            return div({className: 'xh-chat-message__data', item: renderer(part, message)});
        }

        return div({
            className: 'xh-chat-message__data xh-chat-message__data--unrendered',
            items: [
                div({className: 'xh-chat-message__data-type', item: part.dataType}),
                jsonView({value: part.data})
            ]
        });
    }
});

function fileRow(files: ChatFilePart[]): ReactNode {
    return div({
        key: `files-${files[0].id}`,
        className: 'xh-chat-message__files',
        items: files.map(file => chatFileChip({key: file.id, file}))
    });
}

// True while the assistant is working with nothing new to show - before its first content, or
// between a finished tool call and the model's next step.
function isAwaitingContent(message: ChatMessage): boolean {
    if (!message.isStreaming) return false;
    const lastPart = last(message.parts);
    return !lastPart || (lastPart.type === 'toolCall' && isToolCallFinal(lastPart));
}

function statusNote({message, isLast}: ViewProps): ReactNode {
    const {status, error} = message;
    if (status === 'aborted') {
        return div({
            key: 'status',
            className: 'xh-chat-message__note',
            items: [Icon.stopCircle(), 'Stopped']
        });
    }
    // The last message's error shows in the list's error banner, with Retry.
    if (status === 'error' && !isLast) {
        return div({
            key: 'status',
            className: 'xh-chat-message__note xh-chat-message__note--error',
            items: [Icon.warningCircle(), error || 'Failed']
        });
    }
    return null;
}

//------------------------
// Action bar
//------------------------
interface MessageActionsProps extends HoistProps {
    message: ChatMessage;
    chatModel: ChatModel;
    isLast: boolean;

    /** Local model of a user message, to start editing it - null for assistant messages. */
    impl: ChatMessageViewLocalModel;
}

const messageActions = hoistCmp.factory<MessageActionsProps>({
    displayName: 'ChatMessageActions',
    model: false,

    render({message, chatModel, isLast, impl}) {
        const {isBusy} = chatModel,
            hasText = !!message.text.trim(),
            canRegenerate = message.isAssistant && isLast && !isBusy;

        if (!hasText && !canRegenerate && !impl) return null;

        return div({
            className: 'xh-chat-message__actions',
            items: [
                hasText ? chatCopyButton({getCopyText: () => message.text}) : null,
                impl
                    ? button({
                          icon: Icon.edit(),
                          tooltip: 'Edit',
                          disabled: isBusy,
                          onClick: () => impl.startEdit()
                      })
                    : null,
                canRegenerate
                    ? button({
                          icon: Icon.refresh(),
                          tooltip: 'Regenerate',
                          onClick: () => chatModel.regenerateAsync(message.id).catchDefault()
                      })
                    : null
            ]
        });
    }
});
