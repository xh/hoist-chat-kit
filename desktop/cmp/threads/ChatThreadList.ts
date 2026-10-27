import type {ReactNode, Ref} from 'react';
import {includes, isEmpty, times} from 'lodash';
import {clipboardMenuItem} from '@xh/hoist/cmp/clipboard';
import {errorMessage} from '@xh/hoist/cmp/error';
import {a, div, span, vframe} from '@xh/hoist/cmp/layout';
import {
    type BoxProps,
    hoistCmp,
    type HoistProps,
    type MenuItemLike,
    useLocalModel,
    uses
} from '@xh/hoist/core';
import {button, type ButtonProps} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {menuButton, type MenuButtonProps} from '@xh/hoist/desktop/cmp/menu';
import {DATE_FMT, fmtDate, MONTH_DAY_FMT, TIME_FMT} from '@xh/hoist/format';
import {Icon} from '@xh/hoist/icon';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {getTestId} from '@xh/hoist/utils/js';
import {classNames} from '../../../impl/ClassNames';
import {getThreadLabels, type ThreadLabels} from '../../impl/ThreadLabels';
import {chatSpinner} from '../chat';
import '../../../styles/vars.scss';
import {
    type ChatThreadGroup,
    type ChatThreadGroupKey,
    ChatThreadsModel,
    type ChatThreadSummary
} from '../../../threads';
import './ChatThreadList.scss';
import {ChatThreadListLocalModel} from './impl/ChatThreadListLocalModel';

/** Props for {@link ChatThreadList}. */
export interface ChatThreadListProps extends HoistProps<ChatThreadsModel>, BoxProps {
    /** Items to show after New Chat, such as a button that collapses a sidebar. */
    topItems?: ReactNode[];

    /**
     * False to hide the New Chat button, for an app that offers New Chat elsewhere. Default
     * true. `ChatWorkspace` hides its rail and header New Chat buttons too.
     */
    enableNewChat?: boolean;

    /**
     * Called when the user clicks a row, or presses Enter on it, before the thread is selected.
     * Also called for the thread already selected, which a click does not reopen.
     */
    onThreadClick?: (thread: ChatThreadSummary) => void;

    /**
     * A link for a thread, such as its deep link. A row's title is then a link, so that a middle
     * or modifier click opens the thread in a new tab. A plain click selects it, as without.
     */
    getThreadHref?: (thread: ChatThreadSummary) => string;

    /**
     * The word for a thread in the list's own text, such as 'chat'. Default 'thread'. The plural
     * adds an s. `ChatWorkspace` uses it in its header and messages too.
     */
    threadNoun?: string;

    /** False to hide each row's time. A row still says when its thread works. Default true. */
    showTime?: boolean;

    /**
     * False for one plain list in the store's order, with no Today, Yesterday and older groups -
     * for a sidebar with a heading of its own. Default true.
     */
    groupByRecency?: boolean;

    /**
     * Props for each row's More menu button, such as `menuClassName` or `popoverProps`, to match
     * the app's other menus. The list's own `popoverProps` merge over them.
     */
    rowMenuProps?: Omit<MenuButtonProps, 'menuItems' | 'onClick'>;

    /** False to leave Copy Thread ID out of the More menu. Default true. */
    enableCopyId?: boolean;

    /**
     * False to disable Delete for a thread whose turn runs, for a backend that refuses it.
     * Default true: the turn is stopped, then the thread deleted.
     */
    enableDeleteRunning?: boolean;

    /**
     * False to open a new chat when the open thread is deleted. Default true: the next thread in
     * the list opens - the one below it, else the one above - or a new chat if none is left.
     */
    selectNextOnDelete?: boolean;

    /**
     * True for one line per thread: its title, then a short time - the time of day for today and
     * yesterday, the weekday within a week, else the date. Default false: two lines per thread,
     * its title over the date and time of its last activity - or the time alone, under a Today or
     * Yesterday heading.
     */
    compact?: boolean;

    /**
     * Props for the New Chat button, such as `intent` or `outlined`. Default an outlined button
     * with `intent: 'primary'`. `ChatWorkspace` applies them, less `text`, to its other New Chat
     * buttons too.
     */
    newChatButtonProps?: Omit<ButtonProps, 'onClick'>;

    /** False to hide the search input. Default true. */
    enableSearch?: boolean;

    /** Placeholder for the search input. Default 'Search threads', with `threadNoun`. */
    searchPlaceholder?: string;

    /** Ref to the search input's element, so that a container can focus it. */
    searchInputRef?: Ref<HTMLInputElement>;
}

/**
 * A list of a user's threads, for a sidebar: New Chat, a search input, and the threads grouped by
 * recency - Today, Yesterday and older - with the selected thread highlighted.
 *
 * A row shows its title over the date and time of its last activity - or, with `compact`, both on
 * one line. Hover or focus shows Rename and a More menu, whose items include Copy Thread ID and
 * Delete. In a compact row they take the time's place. Rename edits the title in place. Delete asks the
 * user to confirm first. A row also shows when its thread is working, waits for the user, has a
 * reply the user has not seen, or ended its last run early.
 *
 * Backed by a `ChatThreadsModel`: pass it as `model`, or put it in context. The list hides each
 * action the model's store cannot take. The list is a tree grid of
 * one level, as a row holds buttons: Up and Down move between rows, Enter opens one, F2 renames
 * it, and Delete or Backspace deletes it. Right and Left move between a row and its buttons.
 */
export const [ChatThreadList, chatThreadList] = hoistCmp.withFactory<ChatThreadListProps>({
    displayName: 'ChatThreadList',
    model: uses(ChatThreadsModel),
    className: 'xh-chat-thread-list',

    render(props, ref) {
        const {
                model,
                className,
                topItems = [],
                enableNewChat = true,
                compact = false,
                newChatButtonProps,
                enableSearch = true,
                searchPlaceholder,
                searchInputRef,
                onThreadClick,
                getThreadHref,
                threadNoun,
                showTime,
                groupByRecency,
                rowMenuProps,
                enableCopyId,
                enableDeleteRunning,
                selectNextOnDelete,
                testId,
                ...rest
            } = props,
            impl = useLocalModel(ChatThreadListLocalModel),
            labels = getThreadLabels(threadNoun),
            view: ListView = {
                compact,
                labels,
                showTime: showTime !== false,
                getThreadHref,
                rowMenuProps
            };

        return vframe({
            ref,
            className: classNames(className, compact && 'xh-chat-thread-list--compact'),
            testId,
            ...rest,
            items: [
                div({
                    className: 'xh-chat-thread-list__top',
                    omit: !enableNewChat && isEmpty(topItems),
                    items: [
                        enableNewChat
                            ? button({
                                  className: 'xh-chat-thread-list__new',
                                  icon: Icon.add(),
                                  text: 'New Chat',
                                  outlined: true,
                                  intent: 'primary',
                                  testId: getTestId(testId, 'new'),
                                  ...newChatButtonProps,
                                  onClick: () => impl.newThread()
                              })
                            : null,
                        ...topItems
                    ]
                }),
                enableSearch
                    ? div({
                          className: 'xh-chat-thread-list__search',
                          item: textInput({
                              value: model.search,
                              onChange: v => impl.setSearch(v),
                              commitOnChange: true,
                              leftIcon: Icon.search(),
                              enableClear: true,
                              placeholder: searchPlaceholder ?? `Search ${labels.plural}`,
                              inputRef: searchInputRef,
                              width: null,
                              domAttrs: {'aria-label': `Search ${labels.plural}`},
                              testId: getTestId(testId, 'search'),
                              onKeyDown: impl.onSearchKeyDown
                          })
                      })
                    : null,
                div({className: 'xh-chat-thread-list__body', item: body(impl, view)})
            ]
        });
    }
});

//------------------
// Implementation
//------------------
/** What the list renders with, from its props - read at render, not from the local model. */
interface ListView {
    compact: boolean;
    labels: ThreadLabels;
    showTime: boolean;
    getThreadHref: ChatThreadListProps['getThreadHref'];
    rowMenuProps: ChatThreadListProps['rowMenuProps'];
}

function body(impl: ChatThreadListLocalModel, view: ListView): ReactNode {
    const {model, groups} = impl,
        {labels} = view,
        {listError} = model;

    if (listError && isEmpty(model.threads)) {
        return div({
            className: 'xh-chat-thread-list__error',
            role: 'alert',
            item: errorMessage({
                error: listError,
                title: `Couldn't load ${labels.plural}`,
                actionFn: () => impl.retryList(),
                actionButtonProps: {text: 'Retry', icon: Icon.refresh()}
            })
        });
    }

    if (impl.isLoadingFirst) {
        return div({
            className: 'xh-chat-thread-list__skeleton',
            role: 'treegrid',
            'aria-label': labels.titlePlural,
            'aria-busy': true,
            items: times(SKELETON_ROWS, i =>
                div({key: i, className: 'xh-chat-thread-list__skeleton-row'})
            )
        });
    }

    if (isEmpty(groups)) {
        return impl.searchQuery != null ? noResults(impl, view) : emptyList(view);
    }

    return [
        listError
            ? div({
                  key: 'error',
                  className: 'xh-chat-thread-list__refresh-error',
                  role: 'alert',
                  items: [
                      Icon.warningCircle(),
                      span(`Couldn't refresh ${labels.plural}.`),
                      button({text: 'Retry', minimal: true, onClick: () => impl.retryList()})
                  ]
              })
            : null,
        div({
            key: 'list',
            className: 'xh-chat-thread-list__list',
            role: 'treegrid',
            'aria-label': labels.titlePlural,
            'aria-busy': model.listTask.isPending,
            onKeyDown: impl.onListKeyDown,
            items: groups.map(group => threadGroup(impl, group, view))
        })
    ];
}

function threadGroup(
    impl: ChatThreadListLocalModel,
    group: ChatThreadGroup,
    view: ListView
): ReactNode {
    // A row group owns only rows, so its label is its name, and the visible label is hidden.
    return div({
        key: group.key ?? 'all',
        className: 'xh-chat-thread-list__group',
        role: 'rowgroup',
        'aria-label': group.label ?? undefined,
        items: [
            div({
                omit: group.label == null,
                className: 'xh-chat-thread-list__group-label',
                'aria-hidden': true,
                item: group.label
            }),
            ...group.threads.map(thread => threadRow(impl, thread, view, group.key))
        ]
    });
}

function threadRow(
    impl: ChatThreadListLocalModel,
    thread: ChatThreadSummary,
    view: ListView,
    groupKey: ChatThreadGroupKey
): ReactNode {
    const {model} = impl,
        {compact, showTime, getThreadHref} = view,
        {id, title} = thread,
        isSelected = id === model.selectedThreadId,
        status = getRowStatus(model, thread, isSelected),
        isRenaming = impl.renamingThreadId === id,
        time = showTime ? fmtRowTime(thread.lastActivityAt, compact, groupKey) : null,
        timeText = status === 'running' ? 'Working' : time,
        href = getThreadHref?.(thread) ?? null;

    return div({
        key: id,
        id: impl.rowDomId(id),
        role: 'row',
        'aria-level': 1,
        tabIndex: impl.tabbableThreadId === id ? 0 : -1,
        'aria-selected': isSelected,
        'aria-label': [title, STATUS_WORDS[status] ?? time].filter(Boolean).join(', '),
        className: classNames(
            'xh-chat-thread-list__row',
            isSelected && 'xh-chat-thread-list__row--selected',
            status && `xh-chat-thread-list__row--${status}`,
            impl.menuThreadId === id && 'xh-chat-thread-list__row--menu-open',
            isRenaming && 'xh-chat-thread-list__row--renaming'
        ),
        onClick: () => impl.clickThread(thread),
        onFocus: e => {
            if (e.target === e.currentTarget) impl.setFocusThreadId(id);
        },
        items: isRenaming
            ? [renameInput(impl, view)]
            : [
                  // Laid out by the row: the cell only names the row's content for the grid.
                  div({
                      key: 'main',
                      className: 'xh-chat-thread-list__cell',
                      role: 'gridcell',
                      items: [rowIcon(model, thread, status), rowText(impl, title, timeText, href)]
                  }),
                  rowActions(impl, thread, view)
              ]
    });
}

/** The title over the time - as a link, with an href, so that a modifier click opens a tab. */
function rowText(
    impl: ChatThreadListLocalModel,
    title: string,
    timeText: string,
    href: string
): ReactNode {
    const items = [
        span({className: 'xh-chat-thread-list__title', item: title}),
        timeText != null ? span({className: 'xh-chat-thread-list__time', item: timeText}) : null
    ];
    return href != null
        ? a({
              className: 'xh-chat-thread-list__text xh-chat-thread-list__link',
              href,
              tabIndex: -1,
              draggable: false,
              onMouseDown: e => e.preventDefault(),
              onClick: impl.onLinkClick,
              items
          })
        : span({className: 'xh-chat-thread-list__text', items});
}

function rowIcon(model: ChatThreadsModel, thread: ChatThreadSummary, status: RowStatus): ReactNode {
    const className = 'xh-chat-thread-list__icon';
    switch (status) {
        case 'running':
            return span({className, item: chatSpinner()});
        case 'awaiting':
            return span({className, title: 'Waiting for you', item: Icon.pause()});
        case 'new':
            return span({className, item: span({className: 'xh-chat-thread-list__dot'})});
        case 'interrupted':
        case 'failed':
            return span({
                className,
                title: model.endedEarlyThreads[thread.id]?.reason ?? STATUS_TIPS[status],
                item: Icon.warningCircle()
            });
    }
    return span({className});
}

function rowActions(
    impl: ChatThreadListLocalModel,
    thread: ChatThreadSummary,
    view: ListView
): ReactNode {
    const {canRename} = impl,
        {rowMenuProps} = view;

    // Clicks on the buttons stay off the row, which would open the thread.
    return div({
        key: 'actions',
        className: 'xh-chat-thread-list__actions',
        role: 'gridcell',
        onClick: e => e.stopPropagation(),
        items: [
            canRename
                ? button({
                      icon: Icon.edit(),
                      tooltip: 'Rename',
                      'aria-label': 'Rename',
                      tabIndex: -1,
                      onClick: () => impl.startRename(thread)
                  })
                : null,
            menuButton({
                icon: Icon.ellipsisHorizontal(),
                tooltip: 'More',
                'aria-label': 'More',
                tabIndex: -1,
                menuPosition: 'bottom-right',
                ...rowMenuProps,
                menuItems: () => moreMenuItems(impl, thread),
                popoverProps: {
                    // Clear of the button, so that the menu does not cover the next row.
                    modifiers: {offset: {enabled: true, options: {offset: [0, 4]}}},
                    ...rowMenuProps?.popoverProps,
                    onOpening: () => impl.setMenuThreadId(thread.id),
                    onClosed: () => impl.setMenuThreadId(null)
                }
            })
        ]
    });
}

function moreMenuItems(impl: ChatThreadListLocalModel, thread: ChatThreadSummary): MenuItemLike[] {
    const {labels, props} = impl;
    return [
        {
            text: 'Rename',
            icon: Icon.edit(),
            omit: !impl.canRename,
            actionFn: () => impl.startRename(thread)
        },
        {
            ...clipboardMenuItem({
                text: `Copy ${labels.title} ID`,
                icon: Icon.copy(),
                getCopyText: () => thread.id,
                successMessage: `${labels.title} ID copied.`
            }),
            omit: props.enableCopyId === false
        },
        '-',
        deleteMenuItem(impl.canDelete, impl.canDeleteThread(thread), () =>
            impl.deleteThreadAsync(thread).catchDefault()
        )
    ];
}

/**
 * The Delete item of a thread's menu. Disabled, it says why on hover: Hoist menu items take no
 * tooltip, but the label is a node.
 * @internal
 */
export function deleteMenuItem(canDelete: boolean, canDeleteNow: boolean, actionFn: () => void) {
    return {
        text: canDeleteNow ? 'Delete...' : span({title: DELETE_RUNNING_TIP, item: 'Delete...'}),
        icon: Icon.delete(),
        intent: 'danger' as const,
        omit: !canDelete,
        disabled: !canDeleteNow,
        actionFn
    };
}

/** Why Delete is disabled while a thread's turn runs - see `enableDeleteRunning`. */
const DELETE_RUNNING_TIP = 'A reply is in progress. Wait for it to end, then delete.';

function renameInput(impl: ChatThreadListLocalModel, view: ListView): ReactNode {
    // Blur saves, as Enter does. Esc ends the rename before the input blurs.
    return div({
        className: 'xh-chat-thread-list__rename',
        role: 'gridcell',
        onBlur: () => impl.saveRename(),
        onClick: e => e.stopPropagation(),
        item: textInput({
            model: impl,
            bind: 'renameText',
            commitOnChange: true,
            autoFocus: true,
            selectOnFocus: true,
            width: null,
            domAttrs: {'aria-label': `Rename ${view.labels.singular}`},
            onKeyDown: impl.onRenameKeyDown
        })
    });
}

function emptyList(view: ListView): ReactNode {
    return div({
        className: 'xh-chat-thread-list__empty',
        items: [
            div({
                className: 'xh-chat-thread-list__empty-title',
                item: `No ${view.labels.plural} yet`
            }),
            div('Your conversations will be listed here, newest first.')
        ]
    });
}

function noResults(impl: ChatThreadListLocalModel, view: ListView): ReactNode {
    return div({
        className: 'xh-chat-thread-list__empty',
        role: 'status',
        items: [
            div(`No ${view.labels.plural} match '${impl.searchQuery}'`),
            button({text: 'Clear', minimal: true, onClick: () => impl.setSearch(null)})
        ]
    });
}

type RowStatus = 'running' | 'awaiting' | 'new' | 'interrupted' | 'failed';

/** The one unusual state a row shows, in order of priority, or null. */
function getRowStatus(
    model: ChatThreadsModel,
    thread: ChatThreadSummary,
    isSelected: boolean
): RowStatus {
    const {id} = thread;
    if (includes(model.runningThreadIds, id)) return 'running';
    if (includes(model.awaitingThreadIds, id)) return 'awaiting';
    if (!isSelected && includes(model.finishedAwayThreadIds, id)) return 'new';
    return model.endedEarlyThreads[id]?.runEnd ?? null;
}

/** Words a screen reader reads after a row's title, in place of its time. */
const STATUS_WORDS: Record<RowStatus, string> = {
    running: 'working',
    awaiting: 'waiting for you',
    new: 'new reply',
    interrupted: 'last reply interrupted',
    failed: 'last reply failed'
};

/** Tooltips for a row whose last run ended early, when no reason is known. */
const STATUS_TIPS: Partial<Record<RowStatus, string>> = {
    interrupted: 'The last reply was interrupted.',
    failed: 'The last reply failed.'
};

/** A row's time: the time of day for today and yesterday, the weekday this week, else the date. */
/**
 * The time of a thread's last activity, in Hoist's formats. A compact row has room only for the
 * time of day for today and yesterday, the weekday within a week, else the date. A full row shows
 * the date and time, with the year for a date in another year - or, under a Today or Yesterday
 * heading, which already names the day, the time alone.
 */
function fmtRowTime(timestamp: number, compact: boolean, groupKey: ChatThreadGroupKey): string {
    if (timestamp == null) return null;
    const day = LocalDate.from(timestamp),
        today = LocalDate.today();
    let fmt: string;
    if (!compact && (groupKey === 'today' || groupKey === 'yesterday')) {
        fmt = TIME_FMT;
    } else if (compact) {
        fmt =
            day >= today.subtract(1, 'day')
                ? TIME_FMT
                : day > today.subtract(7, 'days')
                  ? 'ddd'
                  : DATE_FMT;
    } else {
        fmt =
            day.startOfYear() === today.startOfYear()
                ? `${MONTH_DAY_FMT}, ${TIME_FMT}`
                : `${MONTH_DAY_FMT}, YYYY, ${TIME_FMT}`;
    }
    return fmtDate(timestamp, fmt) as string;
}

/** Placeholder rows while the first list of threads loads. */
const SKELETON_ROWS = 6;
