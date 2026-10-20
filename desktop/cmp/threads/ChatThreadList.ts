import type {ReactNode, Ref} from 'react';
import {includes, isEmpty, times} from 'lodash';
import {clipboardMenuItem} from '@xh/hoist/cmp/clipboard';
import {errorMessage} from '@xh/hoist/cmp/error';
import {div, span, vframe} from '@xh/hoist/cmp/layout';
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
import {menuButton} from '@xh/hoist/desktop/cmp/menu';
import {DATE_FMT, fmtDate, MONTH_DAY_FMT, TIME_FMT} from '@xh/hoist/format';
import {Icon} from '@xh/hoist/icon';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {getTestId} from '@xh/hoist/utils/js';
import {classNames} from '../../../impl/ClassNames';
import {chatSpinner} from '../chat';
import '../../../styles/vars.scss';
import {type ChatThreadGroup, ChatThreadsModel, type ChatThreadSummary} from '../../../threads';
import './ChatThreadList.scss';
import {ChatThreadListLocalModel} from './impl/ChatThreadListLocalModel';

/** Props for {@link ChatThreadList}. */
export interface ChatThreadListProps extends HoistProps<ChatThreadsModel>, BoxProps {
    /** Items to show after New Chat, such as a button that collapses a sidebar. */
    topItems?: ReactNode[];

    /**
     * True for one line per thread: its title, then a short time - the time of day for today and
     * yesterday, the weekday within a week, else the date. Default false: two lines per thread,
     * its title over the date and time of its last activity.
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

    /** Placeholder for the search input. Default 'Search threads'. */
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
                compact = false,
                newChatButtonProps,
                enableSearch = true,
                searchPlaceholder = 'Search threads',
                searchInputRef,
                testId,
                ...rest
            } = props,
            impl = useLocalModel(ChatThreadListLocalModel);

        return vframe({
            ref,
            className: classNames(className, compact && 'xh-chat-thread-list--compact'),
            testId,
            ...rest,
            items: [
                div({
                    className: 'xh-chat-thread-list__top',
                    items: [
                        button({
                            className: 'xh-chat-thread-list__new',
                            icon: Icon.add(),
                            text: 'New Chat',
                            outlined: true,
                            intent: 'primary',
                            testId: getTestId(testId, 'new'),
                            ...newChatButtonProps,
                            onClick: () => impl.newThread()
                        }),
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
                              placeholder: searchPlaceholder,
                              inputRef: searchInputRef,
                              width: null,
                              domAttrs: {'aria-label': 'Search threads'},
                              testId: getTestId(testId, 'search'),
                              onKeyDown: impl.onSearchKeyDown
                          })
                      })
                    : null,
                div({className: 'xh-chat-thread-list__body', item: body(impl, compact)})
            ]
        });
    }
});

//------------------
// Implementation
//------------------
function body(impl: ChatThreadListLocalModel, compact: boolean): ReactNode {
    const {model, groups} = impl,
        {listError} = model;

    if (listError && isEmpty(model.threads)) {
        return div({
            className: 'xh-chat-thread-list__error',
            role: 'alert',
            item: errorMessage({
                error: listError,
                title: "Couldn't load threads",
                actionFn: () => impl.retryList(),
                actionButtonProps: {text: 'Retry', icon: Icon.refresh()}
            })
        });
    }

    if (impl.isLoadingFirst) {
        return div({
            className: 'xh-chat-thread-list__skeleton',
            role: 'treegrid',
            'aria-label': 'Threads',
            'aria-busy': true,
            items: times(SKELETON_ROWS, i =>
                div({key: i, className: 'xh-chat-thread-list__skeleton-row'})
            )
        });
    }

    if (isEmpty(groups)) {
        return impl.searchQuery != null ? noResults(impl) : emptyList();
    }

    return [
        listError
            ? div({
                  key: 'error',
                  className: 'xh-chat-thread-list__refresh-error',
                  role: 'alert',
                  items: [
                      Icon.warningCircle(),
                      span("Couldn't refresh threads."),
                      button({text: 'Retry', minimal: true, onClick: () => impl.retryList()})
                  ]
              })
            : null,
        div({
            key: 'list',
            className: 'xh-chat-thread-list__list',
            role: 'treegrid',
            'aria-label': 'Threads',
            'aria-busy': model.listTask.isPending,
            onKeyDown: impl.onListKeyDown,
            items: groups.map(group => threadGroup(impl, group, compact))
        })
    ];
}

function threadGroup(
    impl: ChatThreadListLocalModel,
    group: ChatThreadGroup,
    compact: boolean
): ReactNode {
    // A row group owns only rows, so its label is its name, and the visible label is hidden.
    return div({
        key: group.key ?? 'results',
        className: 'xh-chat-thread-list__group',
        role: 'rowgroup',
        'aria-label': group.label,
        items: [
            div({
                className: 'xh-chat-thread-list__group-label',
                'aria-hidden': true,
                item: group.label
            }),
            ...group.threads.map(thread => threadRow(impl, thread, compact))
        ]
    });
}

function threadRow(
    impl: ChatThreadListLocalModel,
    thread: ChatThreadSummary,
    compact: boolean
): ReactNode {
    const {model} = impl,
        {id, title} = thread,
        isSelected = id === model.selectedThreadId,
        status = getRowStatus(model, thread, isSelected),
        isRenaming = impl.renamingThreadId === id,
        time = fmtRowTime(thread.lastActivityAt, compact);

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
        onClick: () => impl.selectThread(id),
        onFocus: e => {
            if (e.target === e.currentTarget) impl.setFocusThreadId(id);
        },
        items: isRenaming
            ? [renameInput(impl)]
            : [
                  // Laid out by the row: the cell only names the row's content for the grid.
                  div({
                      key: 'main',
                      className: 'xh-chat-thread-list__cell',
                      role: 'gridcell',
                      items: [
                          rowIcon(model, thread, status),
                          span({
                              className: 'xh-chat-thread-list__text',
                              items: [
                                  span({className: 'xh-chat-thread-list__title', item: title}),
                                  span({
                                      className: 'xh-chat-thread-list__time',
                                      item: status === 'running' ? 'Working' : time
                                  })
                              ]
                          })
                      ]
                  }),
                  rowActions(impl, thread)
              ]
    });
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

function rowActions(impl: ChatThreadListLocalModel, thread: ChatThreadSummary): ReactNode {
    const {canRename} = impl;

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
                menuItems: () => moreMenuItems(impl, thread),
                popoverProps: {
                    onOpening: () => impl.setMenuThreadId(thread.id),
                    onClosed: () => impl.setMenuThreadId(null)
                }
            })
        ]
    });
}

function moreMenuItems(impl: ChatThreadListLocalModel, thread: ChatThreadSummary): MenuItemLike[] {
    return [
        {
            text: 'Rename',
            icon: Icon.edit(),
            omit: !impl.canRename,
            actionFn: () => impl.startRename(thread)
        },
        clipboardMenuItem({
            text: 'Copy Thread ID',
            icon: Icon.copy(),
            getCopyText: () => thread.id,
            successMessage: 'Thread ID copied.'
        }),
        '-',
        {
            text: 'Delete...',
            icon: Icon.delete(),
            intent: 'danger',
            omit: !impl.canDelete,
            actionFn: () => impl.deleteThreadAsync(thread).catchDefault()
        }
    ];
}

function renameInput(impl: ChatThreadListLocalModel): ReactNode {
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
            domAttrs: {'aria-label': 'Rename thread'},
            onKeyDown: impl.onRenameKeyDown
        })
    });
}

function emptyList(): ReactNode {
    return div({
        className: 'xh-chat-thread-list__empty',
        items: [
            div({className: 'xh-chat-thread-list__empty-title', item: 'No threads yet'}),
            div('Your conversations will be listed here, newest first.')
        ]
    });
}

function noResults(impl: ChatThreadListLocalModel): ReactNode {
    return div({
        className: 'xh-chat-thread-list__empty',
        role: 'status',
        items: [
            div(`No threads match '${impl.searchQuery}'`),
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
 * the date and time, with the year for a date in another year.
 */
function fmtRowTime(timestamp: number, compact: boolean): string {
    if (timestamp == null) return null;
    const day = LocalDate.from(timestamp),
        today = LocalDate.today();
    let fmt: string;
    if (compact) {
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
