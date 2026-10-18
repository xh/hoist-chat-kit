import type {ReactNode} from 'react';
import {isFunction, isString} from 'lodash';
import {clipboardMenuItem} from '@xh/hoist/cmp/clipboard';
import {errorMessage} from '@xh/hoist/cmp/error';
import {div, filler, nav, span, vframe} from '@xh/hoist/cmp/layout';
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
import {chatPanel, type ChatPanelProps, chatSidePanel, chatSpinner} from '../chat';
import {chatThreadList, type ChatThreadListProps} from '../threads';
import {deleteThreadAsync} from '../../impl/ChatThreadDelete';
import {ChatWorkspaceModel} from './ChatWorkspaceModel';
import './ChatWorkspace.scss';
import {ChatWorkspaceLocalModel} from './impl/ChatWorkspaceLocalModel';
import {useWorkspaceWidth} from './impl/useWorkspaceWidth';

/** Content for the workspace's side panel: an element, or a function that renders one. */
export type ChatWorkspaceSidePanel = ReactNode | (() => ReactNode);

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

    /** Props for the side panel's Hoist `Panel` around the app's own content, such as `title`. */
    sidePanelProps?: Omit<PanelProps, 'model' | 'modelConfig' | 'modelRef'>;

    /** Props for the conversation's `ChatPanel`, such as `suggestions` and `composerProps`. */
    chatPanelProps?: Omit<ChatPanelProps, 'model' | 'modelConfig' | 'modelRef'>;

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
                chatPanelProps,
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
                                conversation(model, impl, chatPanelProps, testId)
                            ]
                        }),
                        sidePanelView(model, impl, sidePanel, sidePanelProps, testId)
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
            return rail(model, impl);
    }

    // The box sets the width that shows, which the layout may cut below the user's saved width.
    return div({
        key: 'sidebar',
        className: 'xh-chat-workspace__sidebar-box',
        style: {width: model.sidebarWidth + SPLITTER_WIDTH},
        item: panel({
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
        })
    });
}

function rail(model: ChatWorkspaceModel, impl: ChatWorkspaceLocalModel): ReactNode {
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
            button({
                icon: Icon.add(),
                tooltip: 'New Chat',
                'aria-label': 'New Chat',
                onClick: () => impl.newChat()
            }),
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
            sidebarMode !== 'open'
                ? button({
                      icon: Icon.add(),
                      tooltip: 'New Chat',
                      'aria-label': 'New Chat',
                      onClick: () => impl.newChat()
                  })
                : null,
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
    if (threadsModel.isThreadNotFound && chatModel.isEmpty) {
        return errorMessage({
            key: chatModel.xhId,
            className: 'xh-chat-workspace__not-found',
            testId: getTestId(testId, 'notFound'),
            error: true,
            title: 'Thread not found',
            message: 'This conversation does not exist, or it was deleted.',
            actionFn: () => impl.newChat(),
            actionButtonProps: {text: 'New Chat', icon: Icon.add()}
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

function sidePanelView(
    model: ChatWorkspaceModel,
    impl: ChatWorkspaceLocalModel,
    sidePanel: ChatWorkspaceSidePanel,
    sidePanelProps: ChatWorkspaceProps['sidePanelProps'],
    testId: string
): ReactNode {
    if (!model.isSidePanelShown) return null;

    // The box sets the width that shows, which the layout may cut below the user's saved width.
    const style = {width: model.sidePanelWidth + SPLITTER_WIDTH};

    // A request opened by the conversation - a document, a table or a chart - comes first.
    if (model.sidePanel.request) {
        return div({
            key: 'sidePanel',
            className: 'xh-chat-workspace__side-panel',
            style,
            item: chatSidePanel({
                model: model.sidePanel,
                panelProps: {model: model.sidePanelModel, testId: getTestId(testId, 'sidePanel')}
            })
        });
    }
    if (sidePanel == null) return null;

    const {headerItems = [], ...rest} = sidePanelProps ?? {};
    return div({
        key: 'sidePanel',
        className: 'xh-chat-workspace__side-panel',
        style,
        role: 'complementary',
        onKeyDown: impl.onSidePanelKeyDown,
        'aria-label': isString(rest.title) ? rest.title : 'Side panel',
        item: panel({
            model: model.sidePanelModel,
            testId: getTestId(testId, 'sidePanel'),
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
}

// Hoist's splitter, beside each resizable panel.
const SPLITTER_WIDTH = 8;
