import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ChatAnnouncer} from './ChatAnnouncer';

/**
 * The kit's screen reader announcer. Users rely on polite announcements never crowding each
 * other - at least 2 s apart, with what waits read together - and on failures being read at once.
 */
describe('ChatAnnouncer', () => {
    let announcer: ChatAnnouncer;

    beforeEach(() => {
        vi.useFakeTimers();
        announcer = new ChatAnnouncer();
    });

    afterEach(() => {
        announcer.destroy();
        vi.useRealTimers();
    });

    it('reads the first polite announcement at once', () => {
        announcer.announce('Assistant replied after 4 seconds.');
        expect(announcer.polite.text).toBe('Assistant replied after 4 seconds.');
    });

    it('spaces polite announcements at least 2 s apart, and joins those that wait', () => {
        announcer.announce('Reply stopped.');
        vi.advanceTimersByTime(500);
        announcer.announce('Approval needed: Insert 2 rows.');
        announcer.announce('Feedback sent.');
        expect(announcer.polite.text).toBe('Reply stopped.');

        vi.advanceTimersByTime(1499);
        expect(announcer.polite.text).toBe('Reply stopped.');

        vi.advanceTimersByTime(1);
        expect(announcer.polite.text).toBe('Approval needed: Insert 2 rows. Feedback sent.');
    });

    it('reads a polite announcement at once when the last came 2 s ago or more', () => {
        announcer.announce('First.');
        vi.advanceTimersByTime(2000);
        announcer.announce('Second.');
        expect(announcer.polite.text).toBe('Second.');
    });

    it('reads a repeat of the waiting text once', () => {
        announcer.announce('First.');
        announcer.announce('No response for 30 seconds.');
        announcer.announce('No response for 30 seconds.');
        vi.advanceTimersByTime(2000);
        expect(announcer.polite.text).toBe('No response for 30 seconds.');
    });

    it('reads an assertive announcement at once, even while polite ones wait', () => {
        announcer.announce('First.');
        announcer.announce('Second.');
        announcer.announce('Reply failed: model request timed out.', 'assertive');

        expect(announcer.assertive.text).toBe('Reply failed: model request timed out.');
        expect(announcer.polite.text).toBe('First.');
    });

    it('gives each announcement a new id, so the same text reads again', () => {
        announcer.announce('Reply failed.', 'assertive');
        const {id} = announcer.assertive;
        announcer.announce('Reply failed.', 'assertive');
        expect(announcer.assertive.id).not.toBe(id);
        expect(announcer.assertive.text).toBe('Reply failed.');
    });

    it('ignores blank text', () => {
        announcer.announce('  ');
        announcer.announce(null, 'assertive');
        expect(announcer.polite).toBeNull();
        expect(announcer.assertive).toBeNull();
    });

    it('drops waiting announcements on clear', () => {
        announcer.announce('First.');
        announcer.announce('Second.');
        announcer.clear();
        vi.advanceTimersByTime(5000);
        expect(announcer.polite).toBeNull();
    });

    describe('region hosts', () => {
        const host = (isVisible = true) => ({isVisible: () => isVisible});

        it('shows each announcement in the regions of one host, the newest that is visible', () => {
            const first = host(),
                second = host();
            announcer.attachRegions(first);
            announcer.attachRegions(second);

            announcer.announce('Reply stopped.');
            expect(announcer.getRegionText(second, 'polite')?.text).toBe('Reply stopped.');
            expect(announcer.getRegionText(first, 'polite')).toBeNull();
        });

        it('skips a host that is hidden, such as one in an inactive tab', () => {
            const visible = host(true),
                hidden = host(false);
            announcer.attachRegions(visible);
            announcer.attachRegions(hidden);

            announcer.announce('Reply failed.', 'assertive');
            expect(announcer.getRegionText(visible, 'assertive')?.text).toBe('Reply failed.');
            expect(announcer.getRegionText(hidden, 'assertive')).toBeNull();
        });

        it('never shows an announcement in a host that attached after it was made', () => {
            const first = host();
            announcer.attachRegions(first);
            announcer.announce('Analyst replied after 4 seconds.');

            announcer.detachRegions(first);
            const remounted = host();
            announcer.attachRegions(remounted);

            expect(announcer.polite.text).toBe('Analyst replied after 4 seconds.');
            expect(announcer.getRegionText(remounted, 'polite')).toBeNull();
        });

        it('never moves an announcement to another host when its own detaches', () => {
            const page = host(),
                helper = host();
            announcer.attachRegions(page);
            announcer.attachRegions(helper);
            announcer.announce('Change undone.');

            announcer.detachRegions(helper);

            expect(announcer.getRegionText(page, 'polite')).toBeNull();
        });
    });
});
