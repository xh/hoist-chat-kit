import {groupBy, orderBy} from 'lodash';
import {LocalDate} from '@xh/hoist/utils/datetime';
import type {ChatThreadSummary} from './ChatThreadStore';

/** A group of threads in a thread list - see {@link groupThreadsByRecency}. */
export interface ChatThreadGroup {
    /** Identifies the group, or null for a group that is not a recency group. */
    key: ChatThreadGroupKey | null;

    /** Heading to show for the group, such as 'Previous 7 days', or null for none. */
    label: string | null;

    /** The group's threads, most recently active first. */
    threads: ChatThreadSummary[];
}

/** Identifies a {@link ChatThreadGroup}. */
export type ChatThreadGroupKey =
    'today' | 'yesterday' | 'previous7Days' | 'previous30Days' | 'older';

/**
 * Group threads for a thread list by the day of their last activity - Today, Yesterday, Previous
 * 7 days, Previous 30 days and Older. Days are calendar days in the browser's time zone, so a
 * thread active late last night is in Yesterday, however few hours ago that was. Each group is
 * sorted most recent first. Empty groups are left out.
 *
 * @param now - the current time, in epoch milliseconds. Default now.
 */
export function groupThreadsByRecency(
    threads: ChatThreadSummary[],
    now: number = Date.now()
): ChatThreadGroup[] {
    const today = LocalDate.from(now),
        byKey = groupBy(orderBy(threads, 'lastActivityAt', 'desc'), thread =>
            getGroupKey(thread, today)
        );

    return GROUPS.filter(it => byKey[it.key]).map(it => ({...it, threads: byKey[it.key]}));
}

//------------------
// Implementation
//------------------
const GROUPS: Array<Omit<ChatThreadGroup, 'threads'>> = [
    {key: 'today', label: 'Today'},
    {key: 'yesterday', label: 'Yesterday'},
    {key: 'previous7Days', label: 'Previous 7 days'},
    {key: 'previous30Days', label: 'Previous 30 days'},
    {key: 'older', label: 'Older'}
];

function getGroupKey(thread: ChatThreadSummary, today: LocalDate): ChatThreadGroupKey {
    // A time ahead of the browser's clock - a server's clock may run ahead - counts as today.
    const day = LocalDate.from(thread.lastActivityAt);
    if (day >= today) return 'today';
    if (day >= today.subtract(1, 'day')) return 'yesterday';
    if (day >= today.subtract(7, 'days')) return 'previous7Days';
    if (day >= today.subtract(30, 'days')) return 'previous30Days';
    return 'older';
}
