import {act, render, screen} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {ChatKit, type ChatReplyStatus} from '../../../core';
import {chatElapsed} from './ChatElapsed';
import {chatStatusCue} from './ChatStatusCue';

/**
 * The status cue and the elapsed ticker - the words, icon and color that tell the user what a reply
 * is doing. Users rely on the words carrying every status, on one spinner at most, and on a static
 * twin of that spinner under reduced motion.
 */
describe('ChatStatusCue', () => {
    beforeAll(() => initTestAppAsync());

    afterEach(() => {
        ChatKit.defaults.reducedMotionSpinner = 'static';
    });

    const labels: Array<[ChatReplyStatus, string, string]> = [
        ['submitted', 'Thinking', 'busy'],
        ['streaming', 'Writing', 'busy'],
        ['recomposing', 'Revising', 'busy'],
        ['runningTool', 'Running tools', 'busy'],
        ['paused', 'Waiting for you', 'attention'],
        ['waitingToRetry', 'Waiting to retry', 'meta'],
        ['detached', 'Still working', 'meta'],
        ['stalled', 'No response', 'warning'],
        ['interrupted', 'Interrupted', 'warning'],
        ['cancelledByServer', 'Cancelled by the server', 'warning'],
        ['error', 'The reply failed.', 'error'],
        ['aborted', 'Stopped', 'meta']
    ];

    it.each(labels)('shows %s as "%s", in the %s color', (status, label, intent) => {
        const {container} = render(chatStatusCue({status}));
        expect(screen.getByText(label)).toBeTruthy();
        expect(container.querySelector(`.xh-chat-status-cue--${intent}`)).toBeTruthy();
        expect(container.querySelector('.xh-chat-status-cue__icon')).toBeTruthy();
    });

    it('renders nothing for an idle reply', () => {
        const {container} = render(chatStatusCue({status: 'idle'}));
        expect(container.innerHTML).toBe('');
    });

    it('says how long a stalled reply has had no data', () => {
        render(chatStatusCue({status: 'stalled', stalledMs: 34_400}));
        expect(screen.getByText('No response for 34s')).toBeTruthy();
    });

    it('shows given words in place of the status label', () => {
        render(chatStatusCue({status: 'runningTool', label: 'Running a query'}));
        expect(screen.getByText('Running a query')).toBeTruthy();
    });

    it('renders a busy status with a spinner and its static twin, which CSS swaps', () => {
        const {container} = render(chatStatusCue({status: 'streaming'}));
        expect(container.querySelector('.xh-chat-spinner--static-twin')).toBeTruthy();
        expect(container.querySelector('.xh-chat-spinner__spin')).toBeTruthy();
        expect(container.querySelector('.xh-chat-spinner__static')).toBeTruthy();
    });

    it("keeps Hoist's spinner alone with reducedMotionSpinner 'spin'", () => {
        ChatKit.defaults.reducedMotionSpinner = 'spin';
        const {container} = render(chatStatusCue({status: 'streaming'}));
        expect(container.querySelector('.xh-chat-spinner__spin')).toBeTruthy();
        expect(container.querySelector('.xh-chat-spinner__static')).toBeNull();
    });

    it('leaves out the spinner when told another element shows one', () => {
        const {container} = render(chatStatusCue({status: 'runningTool', showSpinner: false}));
        expect(container.querySelector('.xh-chat-spinner')).toBeNull();
        expect(screen.getByText('Running tools')).toBeTruthy();
    });
});

describe('ChatElapsed', () => {
    beforeAll(() => initTestAppAsync());

    afterEach(() => {
        vi.useRealTimers();
    });

    it('appears at 1 s and ticks each second', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const {container} = render(chatElapsed({startedAt: 100_000}));
        expect(container.textContent).toBe('');

        act(() => vi.advanceTimersByTime(1000));
        expect(container.textContent).toBe('1s');

        act(() => vi.advanceTimersByTime(61_000));
        expect(container.textContent).toBe('1m 02s');
    });

    it('stops at endedAt', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const {container} = render(chatElapsed({startedAt: 90_000, endedAt: 96_000}));
        expect(container.textContent).toBe('6s');

        act(() => vi.advanceTimersByTime(5000));
        expect(container.textContent).toBe('6s');
    });
});
