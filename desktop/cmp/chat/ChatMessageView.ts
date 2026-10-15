import {findLastIndex, isEqual, sumBy} from 'lodash';
import {type ReactElement, type ReactNode, useLayoutEffect, useMemo} from 'react';
import {getRelativeTimestamp, relativeTimestamp} from '@xh/hoist/cmp/relativetimestamp';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, managed, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textArea} from '@xh/hoist/desktop/cmp/input';
import {fmtDateTime} from '@xh/hoist/format';
import {Icon} from '@xh/hoist/icon';
import {action, bindable, observable, observableRef, untracked} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import {createObservableRef, useCached} from '@xh/hoist/utils/react';
import {
    type ChatImagePolicy,
    type ChatMarkdownCitations,
    type ChatMarkdownComponents,
    type ChatMarkdownPlugins,
    chatMarkdown
} from '../../../cmp/markdown';
import {
    chatAnnouncer,
    type ChatCitation,
    type ChatDataPart,
    type ChatFilePart,
    ChatKit,
    CHAT_NO_ANSWER_DATA_TYPE,
    type ChatMessage,
    type ChatMessageListHost,
    ChatModel,
    type ChatPart,
    type ChatPartRenderContext,
    type ChatReasoningPart,
    type ChatSidePanelHost,
    type ChatSourcePart,
    type ChatTextPart,
    type ChatUndoGuard,
    getChatNoAnswerPart,
    getChatReplyStatus,
    isChatUndoGuard
} from '../../../core';
import '../../../styles/vars.scss';
import {chatFileChip} from './ChatFileChip';
import './ChatMessageView.scss';
import {chatNoAnswer} from './ChatNoAnswer';
import {chatReasoning} from './ChatReasoning';
import {chatSources} from './ChatSources';
import {chatStatusCue} from './ChatStatusCue';
import {chatTimeline} from './ChatTimeline';
import {chatToolCall} from './ChatToolCall';
import {fitTextAreaToContent, isImeComposing} from './impl/AutoGrow';
import {
    type ChatReference,
    chatCitations,
    collectReferences,
    collectUncitedSources,
    createMarkerRenderers,
    toSourceList
} from './impl/ChatCitations';
import {chatCopyButton} from './impl/ChatCopyButton';
import {
    chatFeedbackForm,
    ChatMessageFeedbackModel,
    feedbackThumbs
} from './impl/ChatFeedbackControls';
import {chatCaret, chatSpinner} from './impl/ChatLiveCues';
import {chatReplyLiveStatus} from './impl/ChatReplyLiveStatus';
import {chatErrorBoundary} from './impl/ChatErrorBoundary';
import {formatElapsed} from './impl/ChatFormat';
import {chatToolCallGroup} from './impl/ChatToolCallGroup';
import {formatChatUiContext} from '../../../genui/ChatUiAction';
import {classNames} from '../../../impl/ClassNames';
import {getOwn} from '../../../impl/objects';
import {
    type ChatPartGroup,
    type ChatProcessRun,
    type ChatTimelineGroup,
    getToolCallDisplay,
    groupParts,
    groupProcessRuns
} from './impl/groupParts';
import {ChatSourceLinks, findSidePanel} from './impl/ChatSourceLinks';
import {jsonView} from './impl/JsonView';
import {useChatMarkdownComponents} from './impl/MarkdownComponents';
import {formatFailureDetails, getFailureCause, isReplyNotSent} from './impl/ReplyFailure';

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

    /**
     * The conversation that holds the message - for its tools, renderers and actions. A
     * `ChatModel`, or an app's own {@link ChatMessageListHost}.
     */
    host: ChatMessageListHost;

    /** Name shown on assistant messages. Default 'Assistant'. */
    assistantName?: string;

    /** Icon shown on assistant messages. Default from `ChatKit.defaults.assistantIcon`. */
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
     * Called when the user clicks a source, a citation chip or a citation marker. By default a
     * document source opens in the side panel when one is in reach - see `ChatSidePanelHost` - and
     * a web page opens in a new tab. A handler replaces the new tab, and opens a document that the
     * side panel cannot show. Pass a stable function.
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
     * True if this is the last message in the conversation. Its action bar stays shown, and an
     * assistant message offers Regenerate.
     * @internal
     */
    isLast?: boolean;

    /**
     * For a user message whose turn failed before its run started, why - shown as "Not sent"
     * under the bubble. Null otherwise.
     * @internal
     */
    notSentReason?: string;

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

    /**
     * Called when the user chooses Edit Prompt on a failed reply, to edit the user message that
     * asked for it. Shows Edit Prompt if given.
     * @internal
     */
    onEditPrompt?: (reply: ChatMessage) => void;
}

/**
 * One message in a conversation, as a focusable `article`.
 *
 * User messages show as a right-aligned bubble of plain text, with any attached files above it and
 * the structured context sent with it below. Edit and Copy show to the bubble's left on hover or
 * focus.
 *
 * Assistant messages span the column with no bubble, under one quiet header line: the assistant's
 * icon and name, then the reply's status while it runs, or its relative time and time taken once
 * done. Their parts render in order. Reasoning and tool calls stack as quiet rows in a process
 * block, text renders as markdown capped at the prose width, and files and app-rendered data
 * follow, then the sources consulted. Calls to tools with `display: 'timeline'` gather, with the
 * narration between them, into one {@link ChatTimeline} block. With `citationMarkers` on, `[1]` in the text renders as a
 * button for the source it cites. In a chat with a generative UI catalog, component tags in the
 * text render as their components.
 *
 * A reply that ends short says so inline: a failed reply shows what happened, with Edit Prompt, a
 * stopped one shows "Stopped", and one cut off at the length limit says so. The thread's next
 * action - Try Again - belongs to the composer's status region, not the reply.
 *
 * Each part renders as a memoized component that receives the part and a render context that is
 * stable for the life of the message, so a part re-renders only when it changes - not on every
 * streamed change to the message.
 *
 * Once a reply's turn ends, its action bar shows in the gap below it - always on the last reply,
 * on hover or focus on older ones: Copy, Regenerate on the last reply, Undo, thumbs for feedback,
 * then any `messageActions`. Each action shows only if the host supports it. System messages show
 * as a centered note.
 */
export const [ChatMessageView, chatMessageView] = hoistCmp.withFactory<ChatMessageViewProps>({
    displayName: 'ChatMessageView',
    className: 'xh-chat-message',

    render(props, ref) {
        const {className, message, host, assistantName, isLast = false} = props,
            {citationMarkers = false} = props,
            impl = useLocalModel(ChatMessageViewLocalModel),
            context = useMemo<ChatPartRenderContext>(
                () => ({chatModel: host instanceof ChatModel ? host : null, messageId: message.id}),
                [host, message.id]
            ),
            // Kept stable while unchanged, so cited text parts skip render as the message streams.
            references = useCached(collectReferences(message.parts, citationMarkers), isEqual),
            markerSources = useCached(
                citationMarkers ? (message.parts.filter(isSource) as ChatSourcePart[]) : null,
                isEqual
            ),
            {onSourceClick, allowImages = false} = props;
        impl.sourceLinks.configure({
            messageId: message.id,
            sidePanel: impl.sidePanel,
            onSourceClick: onSourceClick ? source => onSourceClick(source, context) : null,
            allowImages
        });
        impl.feedback.configure(message, host);

        // A turn that was never sent shows as "Not sent" on its user message alone.
        if (isReplyNotSent(message)) return null;

        const isSystem = message.role === 'system';
        return div({
            ref,
            className: classNames(className, `xh-chat-message--${message.role}`, {
                'xh-chat-message--streaming': message.isStreaming,
                'xh-chat-message--last': isLast,
                'xh-chat-message--editing': impl.isEditing,
                'xh-chat-message--feedback-open': impl.feedback.form != null
            }),
            role: isSystem ? 'note' : 'article',
            tabIndex: isSystem ? undefined : isLast ? 0 : -1,
            'aria-label': isSystem ? undefined : getAccessibleName(message, assistantName),
            'aria-busy': message.isStreaming || undefined,
            items: message.isUser
                ? userContent(props, impl, context)
                : isSystem
                  ? div({className: 'xh-chat-message__system', item: message.text})
                  : assistantContent(props, impl, context, references, markerSources)
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

    /** True while this view's undo of the reply's changes runs. (observable) */
    @observable accessor isUndoing = false;

    /** Why the last undo failed, if the host's promise rejected. (observable) */
    @observableRef accessor undoRejection: Error = null;

    /** The side panel in reach, which shows the documents the message cites - or null. */
    sidePanel: ChatSidePanelHost = null;

    /** How the message's citations and sources list open their sources. */
    @managed readonly sourceLinks = new ChatSourceLinks();

    /** The message's thumbs and comment form. */
    @managed readonly feedback = new ChatMessageFeedbackModel();

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
        // The side panel above the view, if any - looked up once, as the hierarchy is fixed.
        this.sidePanel = findSidePanel(this);
        this.undoGuard = untracked(() =>
            this.lookupModel(isChatUndoGuard)
        ) as unknown as ChatUndoGuard;

        // Editing may start from outside the view - e.g. Edit Prompt on a failed reply - so seed
        // the draft whenever it starts.
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

    /** Edit the question that a fixed "not found" reply answered. */
    editQuestion = () => this.props.onEditPrompt?.(this.props.message);

    cancelEdit() {
        this.isFocusPending = true;
        this.setEditing(false);
    }

    submitEdit() {
        const {message, host} = this.props,
            text = this.draft.trim();
        if (!text || host.isBusy || host.sendBlockedReason || !host.editMessageAsync) return;
        this.setEditing(false);
        host.composerModel?.focus();
        host.editMessageAsync(message.id, text).catchDefault();
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

    //------------------
    // Undo
    //------------------
    /** The guard in reach that retires Undo, such as a helper's - or null. */
    undoGuard: ChatUndoGuard = null;

    /** True if the host would undo the reply's changes now, retired or not. */
    get isUndoable(): boolean {
        const {message, host} = this.props;
        return !!host.undoTurnAsync && !!host.canUndoTurn?.(message.id);
    }

    /**
     * Why the reply's changes can no longer be undone - such as a hand edit to the component a
     * helper changed - or null.
     */
    get undoRetiredReason(): string {
        if (!this.isUndoable || this.isUndoing) return null;
        return this.undoGuard?.getUndoRetiredReason(this.props.message.id) ?? null;
    }

    /** True if the user can undo the reply's changes now. */
    get canUndo(): boolean {
        return this.isUndoable && !this.undoRetiredReason;
    }

    /**
     * Why the last undo failed, while the reply can still be undone - so that Retry can work -
     * or null.
     */
    get undoError(): Error {
        const {message, host} = this.props;
        if (this.isUndoing || !this.canUndo) return null;
        return host.undoErrors?.[message.id] ?? this.undoRejection;
    }

    /** Undo the reply's changes. A failure shows inline, with Retry - never as a toast. */
    async undoAsync() {
        const {message, host} = this.props;
        if (this.isUndoing || !this.canUndo) return;
        this.setUndoState(true, null);
        let rejection: Error = null;
        try {
            await host.undoTurnAsync(message.id);
        } catch (e) {
            rejection = e;
        }
        this.setUndoState(false, rejection);
        if (rejection ?? host.undoErrors?.[message.id]) {
            chatAnnouncer.announce('Change not undone.', 'assertive');
        } else {
            chatAnnouncer.announce('Change undone.');
        }
    }

    @action
    private setUndoState(isUndoing: boolean, rejection: Error) {
        this.isUndoing = isUndoing;
        this.undoRejection = rejection;
    }

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

/** The message's name for screen readers: its author and when, as "You, 4 minutes ago". */
function getAccessibleName(message: ChatMessage, assistantName: string): string {
    const author = message.isUser ? 'You' : (assistantName ?? 'Assistant');
    return `${author}, ${getRelativeTimestamp(message.createdAt)}`;
}

//------------------------
// User messages
//------------------------
function userContent(
    props: ViewProps,
    impl: ChatMessageViewLocalModel,
    context: ChatPartRenderContext
): ReactNode[] {
    const {message, host, isLast, messageActions, allowImages, notSentReason} = props,
        files = message.parts.filter(it => it.type === 'file') as ChatFilePart[];

    if (impl.isEditing) {
        return [files.length ? fileRow(files, allowImages) : null, editBox({impl, host, message})];
    }

    // The action bar sits beside the bubble, not below it, so that it takes no space of its own.
    // A message of files alone has no bubble, and the bar sits beside the files. A message that
    // was never sent offers Edit below it instead.
    const actions =
            notSentReason == null
                ? actionBar({
                      message,
                      host,
                      context,
                      isLast,
                      isNoAnswer: false,
                      impl,
                      extraActions: messageActions
                  })
                : null,
        under = underBubble(props, impl);
    if (!message.text) {
        return [
            div({className: 'xh-chat-message__row', items: [fileRow(files, allowImages), actions]}),
            under
        ];
    }
    return [
        files.length ? fileRow(files, allowImages) : null,
        div({
            className: 'xh-chat-message__row',
            items: [
                div({
                    className: 'xh-chat-message__bubble',
                    title: fmtDateTime(message.createdAt) as string,
                    item: message.text
                }),
                actions
            ]
        }),
        under
    ];
}

/**
 * What shows below the bubble: the structured context sent with the message, such as the record a
 * button acted on - the model sees it with the message, so the user does too - and "Not sent" for
 * a message whose turn never started.
 */
function underBubble(props: ViewProps, impl: ChatMessageViewLocalModel): ReactNode {
    const {message, host, notSentReason} = props,
        contextText = formatChatUiContext(message.metadata.context),
        items = [
            contextText
                ? div({
                      key: 'context',
                      className: 'xh-chat-message__context',
                      title: 'Sent with the message',
                      item: contextText
                  })
                : null,
            notSentReason != null
                ? div({
                      key: 'notSent',
                      className: 'xh-chat-message__not-sent',
                      items: [
                          Icon.error(),
                          span({
                              className: 'xh-chat-message__not-sent-text',
                              item: 'Not sent.'
                          }),
                          notSentReason
                              ? span({
                                    className: 'xh-chat-message__not-sent-cause',
                                    item: notSentReason
                                })
                              : null,
                          host.editMessageAsync
                              ? button({
                                    ref: impl.editButtonRef,
                                    text: 'Edit',
                                    disabled: host.isBusy,
                                    onClick: () => impl.startEdit()
                                })
                              : null
                      ]
                  })
                : null
        ];
    return items.some(it => it)
        ? div({className: 'xh-chat-message__under', items: items.filter(it => it)})
        : null;
}

interface EditBoxProps extends HoistProps {
    impl: ChatMessageViewLocalModel;
    host: ChatMessageListHost;
    message: ChatMessage;
}

/** Rows the edit box grows to before it scrolls. */
const EDIT_MAX_ROWS = 12;

const editBox = hoistCmp.factory<EditBoxProps>({
    displayName: 'ChatMessageEditBox',
    model: false,

    render({impl, host, message}) {
        const {draft, inputRef} = impl,
            {messages} = host,
            idx = messages.findIndex(it => it.id === message.id),
            laterCount = idx >= 0 ? messages.length - idx - 1 : 0;

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
                    className: 'xh-chat-message__edit-bar',
                    items: [
                        laterCount
                            ? span({
                                  className: 'xh-chat-message__edit-warning',
                                  items: [
                                      Icon.warning(),
                                      `Resending replaces the ${pluralize('message', laterCount, laterCount > 1)} after this one.`
                                  ]
                              })
                            : null,
                        button({text: 'Cancel', onClick: () => impl.cancelEdit()}),
                        button({
                            text: 'Save and Resend',
                            icon: Icon.arrowUp(),
                            intent: 'primary',
                            minimal: false,
                            tooltip: host.sendBlockedReason,
                            disabled: !draft.trim() || host.isBusy || !!host.sendBlockedReason,
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
    impl: ChatMessageViewLocalModel,
    context: ChatPartRenderContext,
    references: ChatReference[],
    markerSources: ChatSourcePart[]
): ReactNode[] {
    const {message, host, isLast, messageActions} = props,
        runs = groupProcessRuns(groupParts(message.parts, host), host),
        // A fixed "not found" reply lists no sources.
        isNoAnswer = !!getChatNoAnswerPart(message),
        uncitedSources = isNoAnswer ? [] : collectUncitedSources(message.parts, references);

    return [
        div({
            key: 'main',
            className: 'xh-chat-message__main',
            items: [
                messageHeader(props, context),
                div({
                    className: 'xh-chat-message__body',
                    items: [
                        ...runs.map((run, idx) =>
                            run.type === 'process'
                                ? processRun(run, props, impl, context, references, markerSources)
                                : run.type === 'timeline'
                                  ? timelineBlock(run, props, context, idx < runs.length - 1)
                                  : renderGroup(
                                        run,
                                        props,
                                        impl,
                                        context,
                                        references,
                                        markerSources
                                    )
                        ),
                        replyNotice(props)
                    ]
                }),
                !isNoAnswer && (references.length || uncitedSources.length)
                    ? chatSources({
                          sources: toSourceList(references),
                          uncitedSources,
                          links: impl.sourceLinks
                      })
                    : null,
                // Actions wait for the turn to end - including one paused for the user's answer.
                message.isStreaming || message.status === 'paused'
                    ? null
                    : actionBar({
                          message,
                          host,
                          context,
                          isLast,
                          isNoAnswer,
                          impl,
                          extraActions: messageActions
                      })
            ]
        }),
        afterReply(props, impl)
    ];
}

function processRun(
    run: ChatProcessRun,
    props: ViewProps,
    impl: ChatMessageViewLocalModel,
    context: ChatPartRenderContext,
    references: ChatReference[],
    markerSources: ChatSourcePart[]
): ReactNode {
    return div({
        key: run.id,
        className: 'xh-chat-message__process',
        items: run.groups.map(group =>
            renderGroup(group, props, impl, context, references, markerSources)
        )
    });
}

/**
 * The reply's activity timeline, for calls to `timeline` tools. Once more of the reply follows
 * it, its line turns to the summary.
 */
function timelineBlock(
    group: ChatTimelineGroup,
    props: ViewProps,
    context: ChatPartRenderContext,
    isFollowed: boolean
): ReactNode {
    const {message, host, isLast} = props;
    return chatErrorBoundary({
        key: group.id,
        item: chatTimeline({
            message,
            host,
            parts: group.parts,
            pinned: group.pinned,
            context,
            isFollowed,
            isLast
        })
    });
}

function renderGroup(
    group: ChatPartGroup,
    props: ViewProps,
    impl: ChatMessageViewLocalModel,
    context: ChatPartRenderContext,
    references: ChatReference[],
    markerSources: ChatSourcePart[]
): ReactNode {
    return chatErrorBoundary({
        key: group.id,
        resetKey: getResetKey(group),
        item: renderPartGroup(group, props, impl, context, references, markerSources)
    });
}

function messageHeader(props: ViewProps, context: ChatPartRenderContext): ReactNode {
    const {message, host, isLast, assistantName, assistantIcon, messageHeaderItems} = props,
        {status, metadata, createdAt} = message,
        isLive = message.isStreaming,
        isPaused = status === 'paused',
        isDone = !isLive && !isPaused,
        elapsed = !isLive ? formatElapsed(metadata?.elapsedMs) : null,
        thought = isDone ? formatElapsed(getHiddenThoughtMs(message)) : null,
        // A timeline counts its own failures.
        failedTools = isDone
            ? message.toolCalls.filter(
                  it => it.state === 'output-error' && getToolCallDisplay(it, host) !== 'timeline'
              ).length
            : 0,
        endedAt = createdAt + (metadata?.elapsedMs ?? 0),
        {dataRefreshedAt} = host,
        isStale = status === 'complete' && dataRefreshedAt != null && dataRefreshedAt > endedAt;

    return div({
        className: 'xh-chat-message__header',
        items: [
            span({
                className: 'xh-chat-message__name',
                items: [
                    span({
                        className: 'xh-chat-message__icon',
                        item: assistantIcon ?? ChatKit.defaults.assistantIcon()
                    }),
                    span({
                        className: 'xh-chat-message__name-text',
                        item: assistantName ?? 'Assistant'
                    })
                ]
            }),
            isLive
                ? chatReplyLiveStatus({
                      className: 'xh-chat-message__segment',
                      message,
                      host,
                      isLast
                  })
                : null,
            isPaused
                ? span({
                      className: 'xh-chat-message__segment',
                      item: chatStatusCue({status: 'paused'})
                  })
                : null,
            isDone
                ? relativeTimestamp({
                      className: 'xh-chat-message__segment xh-chat-message__time',
                      timestamp: createdAt,
                      short: true
                  })
                : null,
            elapsed
                ? span({
                      className: 'xh-chat-message__segment xh-chat-message__elapsed',
                      title: 'Time taken',
                      item: elapsed
                  })
                : null,
            thought
                ? span({
                      className: 'xh-chat-message__segment',
                      title: 'Time spent thinking',
                      item: `Thought for ${thought}`
                  })
                : null,
            failedTools
                ? span({
                      className: 'xh-chat-message__segment xh-chat-message__warning',
                      items: [Icon.warning(), `${pluralize('tool', failedTools, true)} failed`]
                  })
                : null,
            isStale
                ? span({
                      className: 'xh-chat-message__segment xh-chat-message__warning',
                      title:
                          `Replied ${fmtDateTime(endedAt) as string}. ` +
                          `Data refreshed ${fmtDateTime(dataRefreshedAt) as string}.`,
                      items: [Icon.warning(), 'Data refreshed since']
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
    impl: ChatMessageViewLocalModel,
    context: ChatPartRenderContext,
    references: ChatReference[],
    markerSources: ChatSourcePart[]
): ReactNode {
    const {host, markdownComponents, allowImages, markdownPlugins, onEditPrompt} = props;
    switch (group.type) {
        case 'fileGroup':
            return fileRow(group.parts, allowImages);
        case 'toolCallGroup':
            return chatToolCallGroup({parts: group.parts, context, host});
        case 'text':
            return textPart({
                part: group,
                text: group.text,
                isStreaming: group.state === 'streaming',
                citations: group.citations,
                // Only cited text needs the references - passing them otherwise defeats memoization.
                references: group.citations?.length ? references : null,
                markerSources,
                links: impl.sourceLinks,
                context,
                host,
                markdownComponents,
                markdownPlugins,
                allowImages
            });
        case 'reasoning':
            return chatReasoning({part: group, markdownComponents, markdownPlugins, allowImages});
        case 'toolCall':
            return chatToolCall({part: group, context, host});
        case 'data':
            return dataPart({
                part: group,
                context,
                host,
                // Stable, so that the part skips render as the message changes.
                onEditQuestion: onEditPrompt && host.editMessageAsync ? impl.editQuestion : null
            });
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
    links: ChatSourceLinks;
    context: ChatPartRenderContext;
    host: ChatMessageListHost;
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
        links,
        context,
        host,
        markdownComponents,
        markdownPlugins,
        allowImages
    }) {
        const components = useChatMarkdownComponents(markdownComponents),
            // Inline at the end of the last paragraph - memoized, as each new value re-renders it.
            // While the text streams, the caret leads. Keyed by the text's length, so that each
            // arrival restarts its blink.
            caretKey = isStreaming ? text.length : null,
            trailingContent = useMemo(() => {
                const caret = caretKey != null ? chatCaret(caretKey) : null,
                    chips = citations?.length
                        ? chatCitations({key: 'citations', citations, references, links})
                        : null;
                return caret && chips ? [caret, chips] : (caret ?? chips);
            }, [caretKey, citations, references, links]),
            markers = useMemo<ChatMarkdownCitations>(
                () =>
                    markerSources
                        ? {
                              sources: markerSources,
                              onClick: source => links.open(source),
                              ...createMarkerRenderers(links)
                          }
                        : null,
                [markerSources, links]
            ),
            {catalog} = host,
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
    host: ChatMessageListHost;

    /** Edit Question, for a fixed "not found" reply. */
    onEditQuestion: () => void;
}

// The renderer runs as this component's render, so hooks it calls belong to the part. Takes any
// model in context, as `useLocalModel()` needs a component with a model spec.
const dataPart = hoistCmp.factory<DataPartProps>({
    displayName: 'ChatDataPart',
    model: uses('*', {optional: true}),
    className: 'xh-chat-message__data',

    render({className, part, context, host, onEditQuestion}) {
        const renderer = getOwn(host.dataRenderers ?? {}, part.dataType);
        if (renderer) return div({className, item: renderer(part, context)});

        // The built-in template, unless the app registers its own renderer for the type.
        if (part.dataType === CHAT_NO_ANSWER_DATA_TYPE) {
            return div({className, item: chatNoAnswer({part, onEditQuestion})});
        }

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

/**
 * How a reply that ended short ended, inline at the end of its body. A failed reply shows what
 * happened, in the danger color, with Edit Prompt. A server that ended the run says why, in the
 * warning color. A stop is the user's choice, so it stays quiet. A reply cut off at the length
 * limit says so.
 */
function replyNotice(props: ViewProps): ReactNode {
    const {message, onEditPrompt, host} = props;
    if (message.isStreaming || message.status === 'paused') return null;

    const status = getChatReplyStatus({message});
    switch (status) {
        case 'error':
        case 'waitingToRetry':
            return div({
                key: 'notice',
                className: 'xh-chat-message__failed',
                // No live role: the composer's status region announces the failure (D65).
                items: [
                    Icon.error({className: 'xh-chat-message__failed-icon'}),
                    div({
                        className: 'xh-chat-message__failed-text',
                        items: [
                            span({
                                className: 'xh-chat-message__failed-title',
                                item: 'The reply failed.'
                            }),
                            span({
                                className: 'xh-chat-message__failed-cause',
                                item: getFailureCause(message)
                            })
                        ]
                    }),
                    onEditPrompt && host.editMessageAsync
                        ? button({
                              className: 'xh-chat-message__failed-edit',
                              icon: Icon.edit(),
                              text: 'Edit Prompt',
                              disabled: host.isBusy,
                              onClick: () => onEditPrompt(message)
                          })
                        : null
                ]
            });
        case 'interrupted':
        case 'cancelledByServer':
            return notice('xh-chat-message__notice--warning', [
                chatStatusCue({key: 'cue', status}),
                message.error
                    ? span({
                          key: 'reason',
                          className: 'xh-chat-message__notice-detail',
                          item: message.error
                      })
                    : null
            ]);
        case 'aborted':
        case 'detached':
            return notice(null, chatStatusCue({status}));
    }

    // No Redo: the user can ask again.
    if (message.metadata.undone) {
        return notice('xh-chat-message__notice--undone', [
            Icon.undo({key: 'icon'}),
            span({key: 'text', item: 'Changes undone.'})
        ]);
    }

    if (message.metadata.finishReason === 'length') {
        return notice('xh-chat-message__notice--warning', [
            Icon.warning({key: 'icon'}),
            span({key: 'text', item: 'Cut off at the length limit.'})
        ]);
    }
    return null;
}

function notice(className: string, items: ReactNode): ReactNode {
    return div({
        key: 'notice',
        className: classNames('xh-chat-message__notice', className),
        items
    });
}

//------------------------
// Action bar
//------------------------
interface ActionBarProps extends HoistProps {
    message: ChatMessage;
    host: ChatMessageListHost;
    context: ChatPartRenderContext;
    isLast: boolean;

    /** True for a fixed "not found" reply, which has nothing to regenerate. */
    isNoAnswer: boolean;
    impl: ChatMessageViewLocalModel;

    /** App actions, added after the built-in ones. */
    extraActions: ChatMessageRenderFn;
}

const actionBar = hoistCmp.factory<ActionBarProps>({
    displayName: 'ChatMessageActions',
    model: false,

    render({message, host, context, isLast, isNoAnswer, impl, extraActions}) {
        const {isBusy} = host,
            {isAssistant, isUser, status} = message,
            isFailed = isAssistant && status === 'error',
            hasText = !!message.text.trim(),
            // A failed reply has nothing to regenerate: Try Again, above the composer, covers it.
            // TODO(design-open B2) - Regenerate replaces the reply, with no branch switcher.
            canRegenerate =
                isAssistant &&
                isLast &&
                !isBusy &&
                !isFailed &&
                !isNoAnswer &&
                !!host.regenerateAsync,
            {canUndo, isUndoing} = impl,
            canEdit = isUser && !!host.editMessageAsync,
            appActions = extraActions?.(message, context) ?? [],
            primary = [
                isFailed
                    ? chatCopyButton({
                          key: 'copy',
                          label: 'Copy Details',
                          getCopyText: () => formatFailureDetails(message)
                      })
                    : hasText
                      ? chatCopyButton({key: 'copy', getCopyText: () => message.text})
                      : null,
                canEdit
                    ? button({
                          key: 'edit',
                          ref: impl.editButtonRef,
                          icon: Icon.edit(),
                          tooltip: isBusy ? 'Stop the reply to edit' : 'Edit',
                          'aria-label': 'Edit',
                          disabled: isBusy,
                          onClick: () => impl.startEdit()
                      })
                    : null,
                canRegenerate
                    ? button({
                          key: 'regenerate',
                          icon: Icon.refresh(),
                          tooltip: 'Regenerate',
                          'aria-label': 'Regenerate',
                          onClick: () => {
                              // The reply goes, and a pending rating of it with it.
                              impl.feedback.discardForm();
                              host.regenerateAsync(message.id).catchDefault();
                          }
                      })
                    : null,
                canUndo || isUndoing
                    ? button({
                          key: 'undo',
                          icon: isUndoing ? chatSpinner() : Icon.undo(),
                          tooltip: 'Undo changes',
                          'aria-label': 'Undo changes',
                          disabled: isUndoing,
                          onClick: () => impl.undoAsync()
                      })
                    : null
            ].filter(it => it),
            thumbs = impl.feedback.canRate
                ? feedbackThumbs(impl.feedback, isNoAnswer).filter(it => it)
                : [],
            groups = [primary, thumbs, appActions].filter(it => it.length);

        if (!groups.length) return null;

        return div({
            className: 'xh-chat-message__actions',
            role: 'toolbar',
            'aria-label': 'Message actions',
            items: groups.flatMap((items, idx) =>
                idx
                    ? [
                          span({
                              key: `sep${idx}`,
                              className: 'xh-chat-message__actions-sep',
                              'aria-hidden': true
                          }),
                          ...items
                      ]
                    : items
            )
        });
    }
});

/**
 * What shows under a reply, below its action bar: why its changes can no longer be undone, a failed
 * undo of them, with Retry, and the open feedback form.
 */
function afterReply(props: ViewProps, impl: ChatMessageViewLocalModel): ReactNode {
    const {undoError, undoRetiredReason, feedback} = impl,
        undoRetired = undoRetiredReason
            ? div({
                  key: 'undoRetired',
                  className: 'xh-chat-message__notice xh-chat-message__notice--undo-retired',
                  items: [Icon.undo({key: 'icon'}), span({key: 'text', item: undoRetiredReason})]
              })
            : null,
        undoFailure = undoError
            ? div({
                  key: 'undoFailed',
                  className: 'xh-chat-message__undo-failed',
                  items: [
                      Icon.error({className: 'xh-chat-message__undo-failed-icon'}),
                      span({
                          className: 'xh-chat-message__undo-failed-text',
                          item: "Couldn't undo the changes."
                      }),
                      undoError.message
                          ? span({
                                className: 'xh-chat-message__undo-failed-cause',
                                item: undoError.message
                            })
                          : null,
                      button({
                          icon: Icon.refresh(),
                          text: 'Retry',
                          onClick: () => impl.undoAsync()
                      })
                  ]
              })
            : null,
        form = feedback.form ? chatFeedbackForm({key: 'feedback', model: feedback}) : null;

    if (!undoFailure && !undoRetired && !form) return null;
    return div({
        key: 'after',
        className: 'xh-chat-message__after',
        items: [undoRetired, undoFailure, form]
    });
}
