import type {CSSProperties, ReactNode} from 'react';
import {isFunction, isString, omit} from 'lodash';
import {clipboardMenuItem} from '@xh/hoist/cmp/clipboard';
import {errorMessage} from '@xh/hoist/cmp/error';
import {div, filler, nav, placeholder, span, vframe} from '@xh/hoist/cmp/layout';
import {mask} from '@xh/hoist/cmp/mask';
import {
    type BoxProps,
    hoistCmp,
    type HoistProps,
    type MenuItemLike,
    useLocalModel,
    uses
} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {menuButton} from '@xh/hoist/desktop/cmp/menu';
import {useHotkeys} from '@xh/hoist/desktop/hooks';
import {panel, type PanelProps} from '@xh/hoist/desktop/cmp/panel';
import {Icon} from '@xh/hoist/icon';
import {popover} from '@xh/hoist/kit/blueprint';
import {wait} from '@xh/hoist/promise';
import {getTestId} from '@xh/hoist/utils/js';
import {useComposedRefs} from '@xh/hoist/utils/react';
import {classNames} from '../../../impl/ClassNames';
import '../../../styles/vars.scss';
import {
    chatPanel,
    type ChatPanelProps,
    chatSidePanel,
    type ChatSidePanelProps,
    chatSpinner
} from '../chat';
import {chatThreadList, type ChatThreadListProps} from '../threads';
import {deleteThreadAsync} from '../../impl/ChatThreadDelete';
import {ChatWorkspaceModel} from './ChatWorkspaceModel';
import './ChatWorkspace.scss';
import {ChatWorkspaceLocalModel} from './impl/ChatWorkspaceLocalModel';
import {useWorkspaceWidth} from './impl/useWorkspaceWidth';

/** Content for the workspace's side panel: an element, or a function that renders one. */
export type ChatWorkspaceSidePanel = ReactNode | (() => ReactNode);

/** The app's own view of a conversation: an element, or a function that renders one. */
export type ChatWorkspaceConversationView = ReactNode | (() => ReactNode);

/** Props for {@link ChatWorkspace}. */
export interface ChatWorkspaceProps extends HoistProps<ChatWorkspaceModel>, BoxProps {
    /**
     * The header above the conversation. Default the thread's title and its actions. Pass null to
     * show no header.
     */
    header?: ReactNode;

    /** Items to add to the default header, before its own actions. */
    headerItems?: ReactNode[];

    /**
     * One line of persistent context under the header, such as the date of the data the assistant
     * sees. Not for alerts - use a Hoist `Banner` for those. Default none.
     */
    notice?: ReactNode;

    /**
     * The app's own content for the side panel, beside the conversation. It shows while the
     * model's `isSidePanelOpen` is true, no request is open in `ChatWorkspaceModel.sidePanel`, and
     * the workspace has room.
     */
    sidePanel?: ChatWorkspaceSidePanel;

    /**
     * Props for the side panel's Hoist `Panel` around the app's own content, such as `title`. Its
     * header is compact by default, as the conversation's is - pass `compactHeader: false` for a
     * full one.
     */
    sidePanelProps?: Omit<PanelProps, 'model' | 'modelConfig' | 'modelRef'>;

    /**
     * Props for the Hoist `Panel` of a request open in the side panel - a document, a table or a
     * chart - as `ChatSidePanel`'s `panelProps`. Its header is compact by default, as the
     * conversation's is - pass `compactHeader: false` for a full one.
     */
    requestPanelProps?: ChatSidePanelProps['panelProps'];

    /** Props for the conversation's `ChatPanel`, such as `suggestions` and `composerProps`. */
    chatPanelProps?: Omit<ChatPanelProps, 'model' | 'modelConfig' | 'modelRef'>;

    /**
     * The app's own view of the selected thread's conversation, in place of the kit's
     * `ChatPanel` - as for conversations from `ChatThreadsConfig.createConversation`, which run
     * on another library. The view reads the threads model's `conversation` for the thread it
     * shows. The workspace keeps its sidebar, header, notice and side panel, and masks the view
     * while a thread loads. A missing thread or a failed load shows a message and hides the view,
     * which stays mounted. `chatPanelProps` does not apply.
     */
    conversationView?: ChatWorkspaceConversationView;

    /** Props for the sidebar's `ChatThreadList`. */
    threadListProps?: Omit<ChatThreadListProps, 'model' | 'modelConfig' | 'modelRef'>;
}

/**
 * A full-page chat: a thread sidebar, the selected thread's conversation, a header and a notice
 * line above it, and an optional side panel. It fills its parent, and lays itself out by its own
 * measured width, never the viewport's - see {@link ChatWorkspaceModel} for the breakpoints.
 *
 * The sidebar is a Hoist `Panel`, resizable and collapsible to a rail with New Chat and search.
 * Under 788 px it hides, and the header offers the list in a popover. The conversation is a
 * `ChatPanel` for the selected thread's chat. It clears the moment the selection changes, and
 * shows a failed load in its place with Retry. A thread the store reports missing, as from a deep
 * link, shows "Thread not found" with New Chat.
 *
 * The side panel shows the request open in the model's `sidePanel` - such as a document that a
 * citation opened, rendered by the model's `documentRenderer` - else the app's own `sidePanel`
 * content. Components in the conversation find the model's `sidePanel` in model context.
 */
export const [ChatWorkspace, chatWorkspace] = hoistCmp.withFactory<ChatWorkspaceProps>({
    displayName: 'ChatWorkspace',
    model: uses(ChatWorkspaceModel),
    className: 'xh-chat-workspace',

    render(props, ref) {
        const {
                model,
                className,
                header,
                headerItems,
                notice,
                sidePanel,
                sidePanelProps,
                requestPanelProps,
                chatPanelProps,
                conversationView,
                threadListProps,
                testId,
                ...rest
            } = props,
            impl = useLocalModel(ChatWorkspaceLocalModel),
            rootRef = useComposedRefs(ref, useWorkspaceWidth(model));

        return vframe({
            ref: rootRef,
            className: classNames(className, model.isCompact && 'xh-chat--compact'),
            testId,
            ...rest,
            item: useHotkeys(
                div({
                    ref: impl.bodyRef,
                    className: 'xh-chat-workspace__body',
                    style: shownWidths(model),
                    items: [
                        sidebar(model, impl, threadListProps, testId),
                        div({
                            className: 'xh-chat-workspace__main',
                            role: 'main',
                            items: [
                                header === undefined
                                    ? defaultHeader(model, impl, headerItems, threadListProps)
                                    : header,
                                noticeLine(notice),
                                conversationView === undefined
                                    ? conversation(model, impl, chatPanelProps, testId)
                                    : appConversation(model, impl, conversationView, testId)
                            ]
                        }),
                        sidePanelView(
                            model,
                            impl,
                            sidePanel,
                            sidePanelProps,
                            requestPanelProps,
                            testId
                        )
                    ]
                }),
                impl.hotkeys
            )
        });
    }
});

//------------------
// Implementation
//------------------
function sidebar(
    model: ChatWorkspaceModel,
    impl: ChatWorkspaceLocalModel,
    threadListProps: ChatWorkspaceProps['threadListProps'],
    testId: string
): ReactNode {
    switch (model.sidebarMode) {
        case 'hidden':
            return null;
        case 'rail':
            return rail(model, impl, threadListProps);
    }

    // A sibling of the conversation, as Hoist's dragger resizes a panel against its sibling.
    return panel({
        key: 'sidebar',
        model: model.sidebarModel,
        className: 'xh-chat-workspace__sidebar',
        testId: getTestId(testId, 'sidebar'),
        item: nav({
            className: 'xh-chat-workspace__nav',
            'aria-label': 'Threads',
            item: chatThreadList({
                model: model.threadsModel,
                searchInputRef: impl.searchInputRef,
                topItems: [
                    button({
                        key: 'collapse',
                        icon: Icon.chevronLeft(),
                        tooltip: 'Collapse sidebar',
                        'aria-label': 'Collapse sidebar',
                        onClick: () => model.collapseSidebar()
                    })
                ],
                ...threadListProps
            })
        })
    });
}

/**
 * The widths that show, as CSS variables for the panels' content. The layout may cut a panel
 * below its saved size, to leave the conversation its minimum.
 */
function shownWidths(model: ChatWorkspaceModel): CSSProperties {
    const {sidebarWidth, sidePanelWidth} = model;
    return {
        '--xh-chat-workspace-sidebar-width': sidebarWidth == null ? null : `${sidebarWidth}px`,
        '--xh-chat-workspace-side-panel-width':
            sidePanelWidth == null ? null : `${sidePanelWidth}px`
    } as CSSProperties;
}

function rail(
    model: ChatWorkspaceModel,
    impl: ChatWorkspaceLocalModel,
    threadListProps: ChatWorkspaceProps['threadListProps']
): ReactNode {
    const isAnyRunning = !!model.threadsModel.runningThreadIds.length;
    return nav({
        key: 'rail',
        className: 'xh-chat-workspace__rail',
        'aria-label': 'Threads',
        items: [
            button({
                icon: Icon.chevronRight(),
                tooltip: 'Expand sidebar',
                'aria-label': 'Expand sidebar',
                onClick: () => model.expandSidebar()
            }),
            newChatIconButton(impl, threadListProps),
            button({
                icon: Icon.search(),
                tooltip: 'Search threads',
                'aria-label': 'Search threads',
                onClick: () => impl.openSearch()
            }),
            isAnyRunning
                ? span({
                      className: 'xh-chat-workspace__rail-busy',
                      role: 'img',
                      title: 'A thread is working',
                      'aria-label': 'A thread is working',
                      item: chatSpinner()
                  })
                : null
        ]
    });
}

/**
 * New Chat as an icon, for the rail and the header. It takes the thread list's
 * `newChatButtonProps`, less `text`, so that every New Chat button matches.
 */
function newChatIconButton(
    impl: ChatWorkspaceLocalModel,
    threadListProps: ChatWorkspaceProps['threadListProps']
): ReactNode {
    return button({
        icon: Icon.add(),
        tooltip: 'New Chat',
        'aria-label': 'New Chat',
        intent: 'primary',
        ...omit(threadListProps?.newChatButtonProps, 'text', 'testId'),
        onClick: () => impl.newChat()
    });
}

function defaultHeader(
    model: ChatWorkspaceModel,
    impl: ChatWorkspaceLocalModel,
    headerItems: ReactNode[] = [],
    threadListProps: ChatWorkspaceProps['threadListProps']
): ReactNode {
    const {threadsModel, sidebarMode} = model,
        summary = threadsModel.selectedSummary;

    return div({
        className: 'xh-chat-workspace__header',
        items: [
            sidebarMode === 'hidden' ? historyButton(model, impl, threadListProps) : null,
            div({
                className: 'xh-chat-workspace__title',
                role: 'heading',
                'aria-level': 2,
                item: threadsModel.isThreadNotFound
                    ? 'Thread not found'
                    : (summary?.title ?? 'New chat')
            }),
            filler(),
            ...headerItems,
            sidebarMode !== 'open' ? newChatIconButton(impl, threadListProps) : null,
            summary
                ? menuButton({
                      icon: Icon.ellipsisHorizontal(),
                      tooltip: 'Thread actions',
                      'aria-label': 'Thread actions',
                      menuPosition: 'bottom-right',
                      menuItems: () => threadMenuItems(model)
                  })
                : null
        ]
    });
}

/** Under 788 px, the thread list opens from the header, in a popover. */
function historyButton(
    model: ChatWorkspaceModel,
    impl: ChatWorkspaceLocalModel,
    threadListProps: ChatWorkspaceProps['threadListProps']
): ReactNode {
    return popover({
        isOpen: impl.isHistoryOpen,
        onInteraction: open => impl.setHistoryOpen(open),
        position: 'bottom-left',
        minimal: true,
        item: button({
            icon: Icon.history(),
            tooltip: 'Threads',
            'aria-label': 'Threads',
            active: impl.isHistoryOpen
        }),
        content: nav({
            className: 'xh-chat-workspace__history',
            'aria-label': 'Threads',
            item: chatThreadList({model: model.threadsModel, ...threadListProps})
        })
    });
}

function threadMenuItems(model: ChatWorkspaceModel): MenuItemLike[] {
    const {threadsModel} = model,
        summary = threadsModel.selectedSummary;
    if (!summary) return [];

    return [
        clipboardMenuItem({
            text: 'Copy Thread ID',
            icon: Icon.copy(),
            getCopyText: () => summary.id,
            successMessage: 'Thread ID copied.'
        }),
        '-',
        {
            text: 'Delete...',
            icon: Icon.delete(),
            intent: 'danger',
            omit: !threadsModel.canDelete,
            // As from the list: the next thread opens, and focus moves to its composer.
            actionFn: () =>
                deleteThreadAsync(threadsModel, summary, () =>
                    wait().then(() => threadsModel.chatModel?.composerModel?.focus())
                ).catchDefault()
        }
    ];
}

function noticeLine(notice: ReactNode): ReactNode {
    if (notice == null) return null;
    return div({
        className: 'xh-chat-workspace__notice',
        title: isString(notice) ? notice : undefined,
        item: notice
    });
}

function conversation(
    model: ChatWorkspaceModel,
    impl: ChatWorkspaceLocalModel,
    chatPanelProps: ChatWorkspaceProps['chatPanelProps'],
    testId: string
): ReactNode {
    const {threadsModel} = model,
        {chatModel, loadError} = threadsModel;
    if (!chatModel) return null;

    // A thread the store reports missing, as from a deep link, offers a new chat in its place.
    if (threadsModel.isThreadNotFound) return notFound(impl, chatModel.xhId, testId);

    // A thread that has not loaded yet shows a plain pane under the mask, not a new chat's empty
    // state - centered composer and suggestions - which its empty chat would otherwise show.
    if (threadsModel.isThreadLoading && chatModel.isEmpty) {
        return placeholder({
            className: 'xh-chat-workspace__loading',
            testId: getTestId(testId, 'loading'),
            item: mask({bind: threadsModel.loadTask, spinner: true})
        });
    }

    // TODO(D65): announce "Opened [title]" once a selected thread's messages load.
    return chatPanel({
        // A new chat per thread, so that the pane never shows the last thread's messages.
        key: chatModel.xhId,
        model: chatModel,
        className: 'xh-chat-workspace__conversation',
        mask: threadsModel.loadTask,
        testId: getTestId(testId, 'chat'),
        ...chatPanelProps,
        emptyState:
            loadError && chatModel.isEmpty
                ? errorMessage({
                      error: loadError,
                      title: "Couldn't load this thread",
                      actionFn: () => threadsModel.reloadThreadAsync(),
                      actionButtonProps: {text: 'Retry', icon: Icon.refresh()}
                  })
                : chatPanelProps?.emptyState
    });
}

/** The app's own conversation view, with the workspace's states for a missing or failed thread. */
function appConversation(
    model: ChatWorkspaceModel,
    impl: ChatWorkspaceLocalModel,
    conversationView: ChatWorkspaceConversationView,
    testId: string
): ReactNode {
    const {threadsModel} = model,
        {conversation, loadError, isThreadNotFound} = threadsModel;
    if (!conversation) return null;

    let message: ReactNode = null;
    if (isThreadNotFound) {
        message = notFound(impl, 'notFound', testId);
    } else if (loadError) {
        message = errorMessage({
            key: 'loadError',
            className: 'xh-chat-workspace__load-error',
            testId: getTestId(testId, 'loadError'),
            error: loadError,
            title: "Couldn't load this thread",
            actionFn: () => threadsModel.reloadThreadAsync(),
            actionButtonProps: {text: 'Retry', icon: Icon.refresh()}
        });
    }

    // One view for every thread, not one per thread as for a ChatPanel: the app's view follows
    // the selection itself, and may hold state that a remount would lose. A message hides it,
    // and leaves it mounted.
    return [
        message,
        panel({
            key: 'conversation',
            className: 'xh-chat-workspace__conversation',
            testId: getTestId(testId, 'conversation'),
            display: message ? 'none' : undefined,
            mask: threadsModel.loadTask,
            item: isFunction(conversationView) ? conversationView() : conversationView
        })
    ];
}

/** "Thread not found", with New Chat, for a thread the store reports missing. */
function notFound(impl: ChatWorkspaceLocalModel, key: string, testId: string): ReactNode {
    return errorMessage({
        key,
        className: 'xh-chat-workspace__not-found',
        testId: getTestId(testId, 'notFound'),
        error: true,
        title: 'Thread not found',
        message: 'This conversation does not exist, or it was deleted.',
        actionFn: () => impl.newChat(),
        actionButtonProps: {text: 'New Chat', icon: Icon.add()}
    });
}

function sidePanelView(
    model: ChatWorkspaceModel,
    impl: ChatWorkspaceLocalModel,
    sidePanel: ChatWorkspaceSidePanel,
    sidePanelProps: ChatWorkspaceProps['sidePanelProps'],
    requestPanelProps: ChatWorkspaceProps['requestPanelProps'],
    testId: string
): ReactNode {
    if (!model.isSidePanelShown) return null;

    // A request opened by the conversation - a document, a table or a chart - comes first.
    let item: ReactNode;
    if (model.sidePanel.request) {
        item = chatSidePanel({
            model: model.sidePanel,
            panelProps: {compactHeader: true, ...requestPanelProps}
        });
    } else if (sidePanel != null) {
        const {headerItems = [], ...rest} = sidePanelProps ?? {};
        item = div({
            className: 'xh-chat-workspace__side-panel-content',
            role: 'complementary',
            onKeyDown: impl.onSidePanelKeyDown,
            'aria-label': isString(rest.title) ? rest.title : 'Side panel',
            item: panel({
                compactHeader: true,
                ...rest,
                headerItems: [
                    ...headerItems,
                    button({
                        key: 'close',
                        icon: Icon.close(),
                        tooltip: 'Close',
                        'aria-label': 'Close side panel',
                        onClick: () => model.closeSidePanel()
                    })
                ],
                item: isFunction(sidePanel) ? sidePanel() : sidePanel
            })
        });
    } else {
        return null;
    }

    // A sibling of the conversation, as Hoist's dragger resizes a panel against its sibling. The
    // content inside sets its own frame.
    return panel({
        key: 'sidePanel',
        model: model.sidePanelModel,
        className: 'xh-chat-workspace__side-panel',
        testId: getTestId(testId, 'sidePanel'),
        item
    });
}
