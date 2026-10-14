import {findLastIndex, isEmpty, isEqual, last, sumBy} from 'lodash';
import {type ReactElement, type ReactNode, useLayoutEffect, useMemo} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textArea} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, bindable, observable} from '@xh/hoist/mobx';
import {createObservableRef, useCached} from '@xh/hoist/utils/react';
import {
    type ChatImagePolicy,
    type ChatMarkdownCitations,
    type ChatMarkdownComponents,
    type ChatMarkdownPlugins,
    chatMarkdown
} from '../../../cmp/markdown';
import {
    type ChatCitation,
    type ChatDataPart,
    type ChatFilePart,
    type ChatMessage,
    type ChatModel,
    type ChatPart,
    type ChatPartRenderContext,
    type ChatReasoningPart,
    type ChatSourcePart,
    type ChatTextPart,
    isToolCallFinal
} from '../../../core';
import '../../../styles/vars.scss';
import {chatFileChip} from './ChatFileChip';
import './ChatMessageView.scss';
import {chatReasoning} from './ChatReasoning';
import {chatSources} from './ChatSources';
import {chatToolCall} from './ChatToolCall';
import {fitTextAreaToContent, isImeComposing} from './impl/AutoGrow';
import {
    type ChatReference,
    chatCitations,
    collectReferences,
    renderCitationMarker,
    toSourceList
} from './impl/ChatCitations';
import {chatCopyButton} from './impl/ChatCopyButton';
import {chatErrorBoundary} from './impl/ChatErrorBoundary';
import {formatElapsed} from './impl/ChatFormat';
import {chatToolCallGroup} from './impl/ChatToolCallGroup';
import {chatTypingIndicator} from './impl/ChatTypingIndicator';
import {formatChatUiContext} from '../../../genui/ChatUiAction';
import {classNames} from '../../../impl/ClassNames';
import {getOwn} from '../../../impl/objects';
import {type ChatPartGroup, groupParts} from './impl/groupParts';
import {jsonView} from './impl/JsonView';
import {useChatMarkdownComponents} from './impl/MarkdownComponents';

/**
 * Renders extra content for a message - action buttons or header items. Receives the message and
 * its stable render context.
 */
export type ChatMessageRenderFn = (
    message: ChatMessage,
    context: ChatPartRenderContext
) => ReactNode[];

/**
 * Handles a click on a source - in the source list, on a citation chip, or on a citation marker.
 * Receives the source and the render context of its message.
 */
export type ChatSourceClickFn = (source: ChatSourcePart, context: ChatPartRenderContext) => void;

/** Props for {@link ChatMessageView}. */
export interface ChatMessageViewProps extends HoistProps {
    /** The message to show. */
    message: ChatMessage;

    /** The conversation holding the message - for its tools, renderers and actions. */
    chatModel: ChatModel;

    /** Name shown on assistant messages. Default 'Assistant'. */
    assistantName?: string;

    /** Icon shown on assistant messages. Default a sparkles icon. */
    assistantIcon?: ReactElement;

    /**
     * Components to render in place of standard markdown elements, merged over the defaults
     * (which render code blocks with a {@link ChatCodeBlock}). Pass a stable object.
     */
    markdownComponents?: ChatMarkdownComponents;

    /** Images to load - see {@link ChatMarkdownProps.allowImages}. Default false. */
    allowImages?: ChatImagePolicy;

    /**
     * True to render citation markers in assistant text, such as `[1]` and `[1, 2]`, as buttons for
     * the message's sources - see {@link ChatMarkdownProps.citations}. Default false.
     */
    citationMarkers?: boolean;

    /**
     * Called when the user clicks a source, a citation chip or a citation marker. Default opens the
     * source's `url` in a new tab. Pass a stable function.
     */
    onSourceClick?: ChatSourceClickFn;

    /**
     * Plugins to add to the markdown pipeline of assistant text and reasoning - see
     * {@link ChatMarkdownPlugins}. Pass a stable object.
     */
    markdownPlugins?: ChatMarkdownPlugins;

    /** Buttons to add to the action bar, after the built-in ones. Pass a stable function. */
    messageActions?: ChatMessageRenderFn;

    /** Items to add to an assistant message's header. Pass a stable function. */
    messageHeaderItems?: ChatMessageRenderFn;

    /**
     * True if this is the last message in the conversation. Its actions stay visible, and an
     * assistant message offers Regenerate.
     * @internal
     */
    isLast?: boolean;

    /**
     * True to show a user message in edit mode. Pair with `onEditingChange` to control editing
     * from outside - left unset, the view manages its own edit state.
     * @internal
     */
    isEditing?: boolean;

    /**
     * Called when the user starts or ends editing a user message.
     * @internal
     */
    onEditingChange?: (message: ChatMessage, isEditing: boolean) => void;
}

/**
 * One message in a conversation.
 *
 * User messages show as a right-aligned bubble of plain text, with any attached files above it.
 * Assistant messages span the full width with no bubble, under a header with the assistant's name
 * and the time taken. Their parts render in order: markdown text, reasoning, tool calls, files and
 * app-rendered data, followed by the sources consulted. Consecutive tool calls of one step fold
 * into a single "Used 3 tools" row. With `citationMarkers` on, `[1]` in the text renders as a
 * button for the source it cites. In a chat with a generative UI catalog, component tags in the
 * text render as their components.
 *
 * Each part renders as a memoized component that receives the part and a render context that is
 * stable for the life of the message, so a part re-renders only when it changes - not on every
 * streamed change to the message.
 *
 * An action bar shows on hover - beside a user message's bubble, below an assistant message once
 * its turn ends: Copy on every message, Edit on user messages, Regenerate on the last assistant
 * message, then any `messageActions`. A last reply that failed before any content renders nothing,
 * as the list's error banner reports it. System messages show as a centered note.
 */
export const [ChatMessageView, chatMessageView] = hoistCmp.withFactory<ChatMessageViewProps>({
    displayName: 'ChatMessageView',
    className: 'xh-chat-message',

    render(props, ref) {
        const {className, message, chatModel, isLast = false, citationMarkers = false} = props,
            impl = useLocalModel(ChatMessageViewLocalModel),
            context = useMemo<ChatPartRenderContext>(
                () => ({chatModel, messageId: message.id}),
                [chatModel, message.id]
            ),
            // Kept stable while unchanged, so cited text parts skip render as the message streams.
            references = useCached(collectReferences(message.parts, citationMarkers), isEqual),
            markerSources = useCached(
                citationMarkers ? (message.parts.filter(isSource) as ChatSourcePart[]) : null,
                isEqual
            );

        // A last reply that failed before any content is shown by the list's error banner alone.
        if (isLast && message.status === 'error' && isEmpty(message.parts)) return null;

        return div({
            ref,
            className: classNames(className, `xh-chat-message--${message.role}`, {
                'xh-chat-message--streaming': message.isStreaming,
                'xh-chat-message--last': isLast,
                'xh-chat-message--editing': impl.isEditing
            }),
            items: message.isUser
                ? userContent(props, impl, context)
                : message.role === 'system'
                  ? div({className: 'xh-chat-message__system', item: message.text})
                  : assistantContent(props, context, references, markerSources)
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

    readonly inputRef = createObservableRef<HTMLInputElement>();
    readonly editButtonRef = createObservableRef<HTMLElement>();

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

        // A cancelled edit returns focus to the Edit button, which mounts once the box closes.
        this.addReaction({
            track: () => this.editButtonRef.current,
            run: el => {
                if (el && this.isFocusPending) {
                    this.isFocusPending = false;
                    el.focus();
                }
            }
        });
    }

    startEdit() {
        this.setEditing(true);
    }

    cancelEdit() {
        this.isFocusPending = true;
        this.setEditing(false);
    }

    submitEdit() {
        const {message, chatModel} = this.props,
            text = this.draft.trim();
        if (!text || chatModel.isBusy || chatModel.sendBlockedReason) return;
        this.setEditing(false);
        chatModel.composerModel.focus();
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

    private isFocusPending = false;

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
function userContent(
    props: ViewProps,
    impl: ChatMessageViewLocalModel,
    context: ChatPartRenderContext
): ReactNode[] {
    const {message, isLast, messageActions, allowImages} = props,
        files = message.parts.filter(it => it.type === 'file') as ChatFilePart[];

    if (impl.isEditing) {
        return [
            files.length ? fileRow(files, allowImages) : null,
            editBox({impl, chatModel: context.chatModel})
        ];
    }

    // The action bar sits beside the bubble, not below it, so that it takes no space of its own.
    // A message of files alone has no bubble, and the bar sits beside the files.
    const actions = actionBar({message, context, isLast, impl, extraActions: messageActions}),
        contextNote = messageContextNote(message);
    if (!message.text) {
        return [
            div({className: 'xh-chat-message__row', items: [fileRow(files, allowImages), actions]}),
            contextNote
        ];
    }
    return [
        files.length ? fileRow(files, allowImages) : null,
        div({
            className: 'xh-chat-message__row',
            items: [div({className: 'xh-chat-message__bubble', item: message.text}), actions]
        }),
        contextNote
    ];
}

/**
 * The structured context sent with a user message, such as the record a button acted on. The
 * model sees it with the message, so the user does too.
 */
function messageContextNote(message: ChatMessage): ReactNode {
    const text = formatChatUiContext(message.metadata.context);
    return text
        ? div({className: 'xh-chat-message__context', title: 'Sent with the message', item: text})
        : null;
}

interface EditBoxProps extends HoistProps {
    impl: ChatMessageViewLocalModel;
    chatModel: ChatModel;
}

/** Rows the edit box grows to before it scrolls. */
const EDIT_MAX_ROWS = 12;

const editBox = hoistCmp.factory<EditBoxProps>({
    displayName: 'ChatMessageEditBox',
    model: false,

    render({impl, chatModel}) {
        const {draft, inputRef} = impl;

        useLayoutEffect(
            () => fitTextAreaToContent(inputRef.current, EDIT_MAX_ROWS),
            [draft, inputRef]
        );

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
                    domAttrs: {'aria-label': 'Edit message'},
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
                            tooltip: chatModel.sendBlockedReason,
                            disabled:
                                !draft.trim() || chatModel.isBusy || !!chatModel.sendBlockedReason,
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
function assistantContent(
    props: ViewProps,
    context: ChatPartRenderContext,
    references: ChatReference[],
    markerSources: ChatSourcePart[]
): ReactNode[] {
    const {message, isLast, assistantName, messageActions, onSourceClick} = props;

    return [
        messageHeader(props, context),
        div({
            className: 'xh-chat-message__body',
            items: [
                ...groupParts(message.parts, context.chatModel).map(group =>
                    chatErrorBoundary({
                        key: group.id,
                        resetKey: getResetKey(group),
                        item: renderPartGroup(group, props, context, references, markerSources)
                    })
                ),
                isAwaitingContent(message)
                    ? chatTypingIndicator({
                          key: 'typing',
                          label: `${assistantName ?? 'Assistant'} is responding`
                      })
                    : null,
                statusNote(props)
            ]
        }),
        references.length
            ? chatSources({
                  sources: toSourceList(references),
                  onSourceClick: onSourceClick ? source => onSourceClick(source, context) : null
              })
            : null,
        // Actions wait for the turn to end - including one paused for the user's approval.
        message.isStreaming || message.status === 'paused'
            ? null
            : actionBar({message, context, isLast, impl: null, extraActions: messageActions})
    ];
}

function messageHeader(props: ViewProps, context: ChatPartRenderContext): ReactNode {
    const {message, assistantName, assistantIcon, messageHeaderItems} = props,
        isDone = !message.isStreaming,
        elapsed = isDone ? formatElapsed(message.metadata?.elapsedMs) : null,
        thought = isDone ? formatElapsed(getHiddenThoughtMs(message)) : null;

    return div({
        className: 'xh-chat-message__header',
        items: [
            span({className: 'xh-chat-message__avatar', item: assistantIcon ?? Icon.ai()}),
            span({className: 'xh-chat-message__name', item: assistantName ?? 'Assistant'}),
            elapsed
                ? span({className: 'xh-chat-message__meta', title: 'Time taken', item: elapsed})
                : null,
            thought
                ? span({
                      className: 'xh-chat-message__meta',
                      title: 'Time spent thinking',
                      item: `Thought for ${thought}`
                  })
                : null,
            ...(messageHeaderItems?.(message, context) ?? [])
        ]
    });
}

/**
 * Time spent on reasoning with no text to show, which renders no disclosure of its own - or null.
 */
function getHiddenThoughtMs(message: ChatMessage): number {
    const parts = message.parts.filter(
        it => it.type === 'reasoning' && !it.text?.trim() && it.endedAt != null
    ) as ChatReasoningPart[];
    return parts.length ? sumBy(parts, it => it.endedAt - it.startedAt) : null;
}

function renderPartGroup(
    group: ChatPartGroup,
    props: ViewProps,
    context: ChatPartRenderContext,
    references: ChatReference[],
    markerSources: ChatSourcePart[]
): ReactNode {
    const {markdownComponents, allowImages, markdownPlugins, onSourceClick} = props;
    switch (group.type) {
        case 'fileGroup':
            return fileRow(group.parts, allowImages);
        case 'toolCallGroup':
            return chatToolCallGroup({parts: group.parts, context});
        case 'text':
            return textPart({
                part: group,
                text: group.text,
                isStreaming: group.state === 'streaming',
                citations: group.citations,
                // Only cited text needs the references - passing them otherwise defeats memoization.
                references: group.citations?.length ? references : null,
                markerSources,
                onSourceClick,
                context,
                markdownComponents,
                markdownPlugins,
                allowImages
            });
        case 'reasoning':
            return chatReasoning({part: group, markdownComponents, markdownPlugins, allowImages});
        case 'toolCall':
            return chatToolCall({part: group, context});
        case 'data':
            return dataPart({part: group, context});
        default:
            return null;
    }
}

/**
 * When a part that failed to render gets another try: a streaming part when its state moves on,
 * and a data part when it is replaced.
 */
function getResetKey(group: ChatPartGroup): any {
    if ('state' in group) return group.state;
    return group.type === 'data' ? group : null;
}

interface TextPartProps extends HoistProps {
    /** The part, for the components of its tags. */
    part: ChatTextPart;
    text: string;
    isStreaming: boolean;
    citations: ChatCitation[];
    references: ChatReference[];

    /** Sources for citation markers in the text - null unless `citationMarkers` is on. */
    markerSources: ChatSourcePart[];
    onSourceClick: ChatSourceClickFn;
    context: ChatPartRenderContext;
    markdownComponents: ChatMarkdownComponents;
    markdownPlugins: ChatMarkdownPlugins;
    allowImages: ChatImagePolicy;
}

const textPart = hoistCmp.factory<TextPartProps>({
    displayName: 'ChatTextPart',
    model: false,

    render({
        part,
        text,
        isStreaming,
        citations,
        references,
        markerSources,
        onSourceClick,
        context,
        markdownComponents,
        markdownPlugins,
        allowImages
    }) {
        const components = useChatMarkdownComponents(markdownComponents),
            onClick = useMemo(
                () =>
                    onSourceClick
                        ? (source: ChatSourcePart) => onSourceClick(source, context)
                        : null,
                [onSourceClick, context]
            ),
            // Inline at the end of the last paragraph - memoized, as each new value re-renders it.
            trailingContent = useMemo(
                () =>
                    citations?.length
                        ? chatCitations({citations, references, onSourceClick: onClick})
                        : null,
                [citations, references, onClick]
            ),
            markers = useMemo<ChatMarkdownCitations>(
                () =>
                    markerSources
                        ? {sources: markerSources, onClick, renderMarker: renderCitationMarker}
                        : null,
                [markerSources, onClick]
            ),
            {catalog} = context.chatModel,
            segments = useMemo(
                () => catalog?.parseTags(text, {isStreaming}) ?? null,
                [catalog, text, isStreaming]
            ),
            // Only the end of the text streams, and citations trail its last markdown.
            markdown = (content: string, isEnd: boolean, isLastMarkdown: boolean, key?: string) =>
                chatMarkdown({
                    key,
                    content,
                    isStreaming: isStreaming && isEnd,
                    components,
                    allowImages,
                    trailingContent: isLastMarkdown ? trailingContent : null,
                    citations: markers,
                    markdownPlugins
                });

        // Text with no component tags - the common case - renders as one block of markdown.
        if (!segments?.some(it => it.type !== 'markdown')) {
            return div({className: 'xh-chat-message__text', item: markdown(text, true, true)});
        }

        // Segments only grow at the end as the text streams, so their index is a stable key.
        const lastMarkdownIdx = findLastIndex(segments, it => it.type === 'markdown');
        return div({
            className: 'xh-chat-message__text',
            items: segments.map((segment, idx) =>
                segment.type === 'markdown'
                    ? markdown(
                          segment.text,
                          idx === segments.length - 1,
                          idx === lastMarkdownIdx,
                          `s${idx}`
                      )
                    : div({
                          key: `s${idx}`,
                          className: 'xh-chat-message__ui',
                          item: catalog.renderSegment(segment, {...context, part})
                      })
            )
        });
    }
});

interface DataPartProps extends HoistProps {
    part: ChatDataPart;
    context: ChatPartRenderContext;
}

// The renderer runs as this component's render, so hooks it calls belong to the part. Takes any
// model in context, as `useLocalModel()` needs a component with a model spec.
const dataPart = hoistCmp.factory<DataPartProps>({
    displayName: 'ChatDataPart',
    model: uses('*', {optional: true}),
    className: 'xh-chat-message__data',

    render({className, part, context}) {
        const renderer = getOwn(context.chatModel.dataRenderers, part.dataType);
        if (renderer) return div({className, item: renderer(part, context)});

        return div({
            className: classNames(className, 'xh-chat-message__data--unrendered'),
            items: [
                div({className: 'xh-chat-message__data-type', item: part.dataType}),
                jsonView({value: part.data})
            ]
        });
    }
});

function fileRow(files: ChatFilePart[], allowImages: ChatImagePolicy): ReactNode {
    return div({
        key: `files-${files[0].id}`,
        className: 'xh-chat-message__files',
        items: files.map(file => chatFileChip({key: file.id, file, allowImages}))
    });
}

function isSource(part: ChatPart): boolean {
    return part.type === 'source';
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
interface ActionBarProps extends HoistProps {
    message: ChatMessage;
    context: ChatPartRenderContext;
    isLast: boolean;

    /** Local model of a user message, to start editing it - null for assistant messages. */
    impl: ChatMessageViewLocalModel;

    /** App actions, added after the built-in ones. */
    extraActions: ChatMessageRenderFn;
}

const actionBar = hoistCmp.factory<ActionBarProps>({
    displayName: 'ChatMessageActions',
    model: false,

    render({message, context, isLast, impl, extraActions}) {
        const {chatModel} = context,
            {isBusy} = chatModel,
            hasText = !!message.text.trim(),
            // A failed last reply offers Retry in the list's error banner instead.
            canRegenerate = message.isAssistant && isLast && !isBusy && message.status !== 'error',
            canUndo = chatModel.canUndoTurn(message.id),
            appActions = extraActions?.(message, context) ?? [];

        if (!hasText && !canRegenerate && !canUndo && !impl && isEmpty(appActions)) return null;

        return div({
            className: 'xh-chat-message__actions',
            items: [
                hasText ? chatCopyButton({getCopyText: () => message.text}) : null,
                impl
                    ? button({
                          ref: impl.editButtonRef,
                          icon: Icon.edit(),
                          tooltip: 'Edit',
                          'aria-label': 'Edit',
                          disabled: isBusy,
                          onClick: () => impl.startEdit()
                      })
                    : null,
                canRegenerate
                    ? button({
                          icon: Icon.refresh(),
                          tooltip: 'Regenerate',
                          'aria-label': 'Regenerate',
                          onClick: () => chatModel.regenerateAsync(message.id).catchDefault()
                      })
                    : null,
                canUndo
                    ? button({
                          icon: Icon.undo(),
                          tooltip: 'Undo changes',
                          'aria-label': 'Undo changes',
                          onClick: () => chatModel.undoTurnAsync(message.id).catchDefault()
                      })
                    : null,
                ...appActions
            ]
        });
    }
});
