import {describe, expect, it} from 'vitest';
import {
    IDLE_WATCH,
    isRunningOnServer,
    isWatchActive,
    type RunFacts,
    type RunWatch,
    type RunWatchEvent,
    shouldReload,
    stepRunWatch
} from './RunWatch';

/**
 * The run watch is the one record of what the threads model knows about a turn that runs on the
 * server while its chat does not follow it. Every rule that decides whether sends wait, whether
 * the model checks on its own, and when it reloads a history, reads from it - so each transition
 * is pinned here, apart from the timers and stores that drive it.
 */
describe('RunWatch', () => {
    const TIMEOUT = 60_000;

    describe('stepRunWatch', () => {
        it('waits on a turn the list shows running, with no reply in the history', () => {
            expect(step(IDLE_WATCH, RUNNING_NO_REPLY)).toMatchObject({
                phase: 'waiting',
                since: 1000,
                seenRunning: true
            });
            // A finished reply, or a turn the list does not show running, needs nothing.
            expect(step(IDLE_WATCH, {...RUNNING_NO_REPLY, lacksReply: false})).toBe(IDLE_WATCH);
            expect(step(IDLE_WATCH, {...RUNNING_NO_REPLY, listedRunning: false})).toBe(IDLE_WATCH);
            expect(step(IDLE_WATCH, {...RUNNING_NO_REPLY, listedRunning: null})).toBe(IDLE_WATCH);
        });

        it('reloads a reply that may still change, as a reply due but not awaited', () => {
            expect(step(IDLE_WATCH, UNSETTLED)).toMatchObject({
                phase: 'reloading',
                isAwaiting: false,
                reloadAfter: 3
            });
        });

        it('falls due once a list shows done the turn it waits on', () => {
            const waiting = step(IDLE_WATCH, RUNNING_NO_REPLY),
                due = step(waiting, {...RUNNING_NO_REPLY, listedRunning: false, now: 2000});

            expect(due).toMatchObject({
                phase: 'reloading',
                isAwaiting: true,
                reloadAfter: 3,
                since: 2000
            });
        });

        it('settles only on a load begun since the reply fell due', () => {
            const due = dueFrom(RUNNING_NO_REPLY),
                stale = {...RUNNING_NO_REPLY, listedRunning: false},
                done = {...SETTLED, listedRunning: false};

            // A load begun before the list showed the turn done holds no reply yet.
            expect(step(due, stale, {type: 'loaded', key: 3}).phase).toBe('reloading');
            expect(step(due, done, {type: 'loaded', key: 4})).toBe(IDLE_WATCH);
        });

        it('keeps a reply due when its reload lands before the backend saved it', () => {
            const due = dueFrom(RUNNING_NO_REPLY),
                notSaved = {...RUNNING_NO_REPLY, listedRunning: false};

            expect(step(due, notSaved, {type: 'loaded', key: 4})).toMatchObject({
                phase: 'reloading',
                reloadAfter: 4
            });
        });

        it('stops when a reload settles nothing, and waits again on a turn still running', () => {
            const due = dueFrom(RUNNING_NO_REPLY),
                loaded: RunWatchEvent = {type: 'loaded', key: 4};

            expect(step(due, {...UNSETTLED, listedRunning: false}, loaded).phase).toBe('stopped');
            expect(step(due, RUNNING_NO_REPLY, loaded).phase).toBe('waiting');
        });

        it('goes idle once the history shows the reply, from any phase', () => {
            const waiting = step(IDLE_WATCH, RUNNING_NO_REPLY);
            expect(step(waiting, SETTLED)).toBe(IDLE_WATCH);
            expect(step(dueFrom(RUNNING_NO_REPLY), SETTLED)).toBe(IDLE_WATCH);
            expect(step(stoppedFrom(RUNNING_NO_REPLY), SETTLED)).toBe(IDLE_WATCH);
        });

        it('stops at the timeout, on a check only', () => {
            const waiting = step(IDLE_WATCH, RUNNING_NO_REPLY),
                late = {...RUNNING_NO_REPLY, now: 1000 + TIMEOUT};

            expect(step(waiting, late, {type: 'changed'}).phase).toBe('waiting');
            expect(step(waiting, late, {type: 'tick'}).phase).toBe('stopped');
        });

        it('brings the reply of a turn a list shows done, even once stopped', () => {
            const stopped = stoppedFrom(RUNNING_NO_REPLY),
                due = step(stopped, {...RUNNING_NO_REPLY, listedRunning: false, now: 9000});

            expect(due).toMatchObject({phase: 'reloading', isAwaiting: true, since: 9000});
        });

        it('never loops on a run that died: stopped stays stopped as lists come and go', () => {
            const died = {...UNSETTLED, listedRunning: false},
                stopped = step(step(IDLE_WATCH, died), died, {type: 'loaded', key: 4});

            expect(stopped.phase).toBe('stopped');
            expect(step(stopped, died)).toBe(stopped);
            expect(shouldReload(stopped, died, {type: 'tick'})).toBe(false);
        });

        it('goes idle on a turn of its own, or a reset', () => {
            const waiting = step(IDLE_WATCH, RUNNING_NO_REPLY);
            expect(step(waiting, {...RUNNING_NO_REPLY, isBusy: true})).toBe(IDLE_WATCH);
            expect(step(waiting, RUNNING_NO_REPLY, {type: 'reset'})).toBe(IDLE_WATCH);
        });

        it('marks a reload in flight, whatever the phase', () => {
            const due = dueFrom(RUNNING_NO_REPLY),
                started = step(due, RUNNING_NO_REPLY, {type: 'reloadStarted'});

            expect(started).toMatchObject({phase: 'reloading', isReloading: true});
            expect(step(started, SETTLED, {type: 'loaded', key: 4})).toMatchObject({
                phase: 'idle',
                isReloading: true
            });
            expect(step(started, RUNNING_NO_REPLY, {type: 'reloadEnded'}).isReloading).toBe(false);
        });
    });

    describe('isRunningOnServer', () => {
        it('holds while the list shows the turn running, and until a due reply loads', () => {
            const waiting = step(IDLE_WATCH, RUNNING_NO_REPLY),
                done = {...RUNNING_NO_REPLY, listedRunning: false};

            expect(isRunningOnServer(waiting, RUNNING_NO_REPLY)).toBe(true);
            expect(isRunningOnServer(step(waiting, done), done)).toBe(true);
            expect(isRunningOnServer(IDLE_WATCH, done)).toBe(false);
            expect(isRunningOnServer(waiting, {...RUNNING_NO_REPLY, isBusy: true})).toBe(false);
            // A history that failed to load shows its failure, not a reply on its way.
            expect(isRunningOnServer(waiting, {...RUNNING_NO_REPLY, isLoadFailed: true})).toBe(
                false
            );
        });

        it('never holds for a reply that may change while the list shows no run', () => {
            const due = step(IDLE_WATCH, UNSETTLED);
            expect(isRunningOnServer(due, UNSETTLED)).toBe(false);
            expect(isWatchActive(due)).toBe(true);
        });
    });

    describe('shouldReload', () => {
        it('reloads a due reply at once, and at each check, but never twice at a time', () => {
            const due = dueFrom(RUNNING_NO_REPLY),
                facts = {...RUNNING_NO_REPLY, listedRunning: false};

            expect(shouldReload(due, facts, {type: 'changed'})).toBe(true);
            expect(shouldReload(due, facts, {type: 'loaded', key: 3})).toBe(true);
            expect(shouldReload(due, facts, {type: 'tick'})).toBe(true);
            // A failed reload waits for the next check, rather than retrying at once.
            expect(shouldReload(due, facts, {type: 'reloadEnded'})).toBe(false);
            expect(shouldReload({...due, isReloading: true}, facts, {type: 'tick'})).toBe(false);
            expect(shouldReload(due, {...facts, isLoaded: false}, {type: 'tick'})).toBe(false);
        });

        it('reloads a reply that may change at a check, once the list shows no run going', () => {
            const due = step(IDLE_WATCH, UNSETTLED);

            expect(shouldReload(due, UNSETTLED, {type: 'changed'})).toBe(false);
            expect(shouldReload(due, UNSETTLED, {type: 'tick'})).toBe(true);
            expect(shouldReload(due, {...UNSETTLED, listedRunning: true}, {type: 'tick'})).toBe(
                false
            );
        });

        it('reloads a waited-on thread with no messages at each check, to show the turn saved', () => {
            const waiting = step(IDLE_WATCH, RUNNING_NO_REPLY);

            expect(shouldReload(waiting, RUNNING_NO_REPLY, {type: 'tick'})).toBe(true);
            expect(
                shouldReload(waiting, {...RUNNING_NO_REPLY, isEmpty: false}, {type: 'tick'})
            ).toBe(false);
            expect(shouldReload(waiting, RUNNING_NO_REPLY, {type: 'changed'})).toBe(false);
        });
    });

    //------------------
    // Helpers
    //------------------
    function step(watch: RunWatch, facts: RunFacts, event: RunWatchEvent = {type: 'changed'}) {
        return stepRunWatch(watch, facts, event, TIMEOUT);
    }

    function dueFrom(facts: RunFacts): RunWatch {
        return step(step(IDLE_WATCH, facts), {...facts, listedRunning: false});
    }

    function stoppedFrom(facts: RunFacts): RunWatch {
        return step(step(IDLE_WATCH, facts), {...facts, now: facts.now + TIMEOUT}, {type: 'tick'});
    }
});

const RUNNING_NO_REPLY: RunFacts = {
    isBusy: false,
    isLoaded: true,
    isLoadFailed: false,
    listedRunning: true,
    isEmpty: true,
    lacksReply: true,
    isUnsettled: false,
    loadKey: 3,
    now: 1000
};

const SETTLED: RunFacts = {...RUNNING_NO_REPLY, isEmpty: false, lacksReply: false};

const UNSETTLED: RunFacts = {...SETTLED, listedRunning: null, isUnsettled: true};
