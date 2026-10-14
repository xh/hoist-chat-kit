import {describe, expect, it} from 'vitest';
import type {ChatThreadSummary} from './ChatThreadStore';
import {groupThreadsByRecency} from './groupThreadsByRecency';

/**
 * Recency groups for a thread list. Users scan these headings to find a recent conversation, so a
 * thread must land in the group its calendar day names - in the browser's time zone, and across
 * daylight saving changes. Tests run in America/New_York.
 */
describe('groupThreadsByRecency', () => {
    // Wednesday 11 March 2026, 9:00 in New York - three days after clocks went forward.
    const now = local(2026, 3, 11, 9);

    it('groups threads by the calendar day of their last activity', () => {
        const groups = groupThreadsByRecency(
            [
                thread('today', local(2026, 3, 11, 0, 5)),
                thread('yesterday', local(2026, 3, 10, 23, 55)),
                thread('lastWeek', local(2026, 3, 4, 12)),
                thread('lastMonth', local(2026, 2, 9, 12)),
                thread('older', local(2026, 2, 8, 12))
            ],
            now
        );

        expect(groups.map(it => [it.key, it.label, it.threads.map(t => t.id)])).toEqual([
            ['today', 'Today', ['today']],
            ['yesterday', 'Yesterday', ['yesterday']],
            ['previous7Days', 'Previous 7 days', ['lastWeek']],
            ['previous30Days', 'Previous 30 days', ['lastMonth']],
            ['older', 'Older', ['older']]
        ]);
    });

    it('counts days across a daylight saving change by the calendar', () => {
        // Clocks went forward on 8 March, so 7 days before midnight today, counted in hours, is
        // 11pm on 3 March - not the start of 4 March.
        const groups = groupThreadsByRecency(
            [
                thread('sevenDays', local(2026, 3, 4, 0, 30)),
                thread('eightDays', local(2026, 3, 3, 23))
            ],
            now
        );

        expect(groups.map(it => [it.key, it.threads.map(t => t.id)])).toEqual([
            ['previous7Days', ['sevenDays']],
            ['previous30Days', ['eightDays']]
        ]);
    });

    it('puts pinned threads first, and sorts each group most recent first', () => {
        const groups = groupThreadsByRecency(
            [
                thread('early', local(2026, 3, 11, 7)),
                thread('pinnedOld', local(2025, 1, 1, 12), true),
                thread('late', local(2026, 3, 11, 8)),
                thread('pinnedNew', local(2026, 3, 10, 12), true)
            ],
            now
        );

        expect(groups.map(it => [it.key, it.threads.map(t => t.id)])).toEqual([
            ['pinned', ['pinnedNew', 'pinnedOld']],
            ['today', ['late', 'early']]
        ]);
    });

    it('counts a time ahead of the clock as today, and leaves out empty groups', () => {
        const groups = groupThreadsByRecency([thread('ahead', local(2026, 3, 12, 9))], now);

        expect(groups.map(it => it.key)).toEqual(['today']);
        expect(groupThreadsByRecency([], now)).toEqual([]);
    });
});

/** Epoch millis for a local time, with a 1-based month. */
function local(year: number, month: number, day: number, hour: number, minute = 0): number {
    return new Date(year, month - 1, day, hour, minute).getTime();
}

function thread(id: string, lastActivityAt: number, pinned = false): ChatThreadSummary {
    return {id, title: id, lastActivityAt, pinned};
}
