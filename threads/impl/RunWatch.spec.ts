import {describe, expect, it} from 'vitest';
import {
    DUE_RELOADS,
    IDLE_WATCH,
    isRunningOnServer,
    isWatchAutomatic,
    type RunFacts,
    type RunWatch,
    type RunWatchEvent,
    stepRunWatch
} from './RunWatch';

/**
 * The run watch is the one record of what the threads model knows about a turn that runs on the
 * server while its chat does not follow it. Whether sends wait, whether the model checks on its
 * own, and when it reloads a history all come from it - so each transition is pinned here, apart
 * from the timers and stores that drive it.
 */
describe('RunWatch', () => {
    const TIMEOUT = 60_000;

    describe('idle', () => {
        it('waits on a turn the list shows running, with no reply in the history', () => {
            for (const history of ['empty', 'question', 'detached'] as const) {
                expect(phaseOf(IDLE_WATCH, {...RUNNING, history})).toBe('waiting');
            }
        });

        it('settles a reply that may still change, with no run listed', () => {
            expect(phaseOf(IDLE_WATCH, {...DONE, history: 'detached'})).toBe('settling');
            expect(phaseOf(IDLE_WATCH, {...DONE, listedRunning: null, history: 'detached'})).toBe(
                'settling'
            );
            expect(phaseOf(IDLE_WATCH, {...RUNNING, history: 'unsafeFailure'})).toBe('settling');
        });

        it('watches nothing for a finished reply, an unsaved thread, or a failed load', () => {
            expect(phaseOf(IDLE_WATCH, {...RUNNING, history: 'replied'})).toBe('idle');
            expect(phaseOf(IDLE_WATCH, {...RUNNING, isSaved: false})).toBe('idle');
            expect(phaseOf(IDLE_WATCH, {...RUNNING, isLoadFailed: true})).toBe('idle');
            expect(phaseOf(IDLE_WATCH, {...DONE, history: 'question'})).toBe('idle');
        });

        it('goes idle on a turn of its own, from any phase', () => {
            const waiting = run(IDLE_WATCH, RUNNING).watch;
            expect(run(waiting, {...RUNNING, isBusy: true}, {type: 'turn'}).watch).toBe(IDLE_WATCH);
        });

        it('reads the new facts on a reset', () => {
            const waiting = run(IDLE_WATCH, RUNNING).watch;
            expect(phaseOf(waiting, {...DONE, history: 'empty'}, {type: 'reset'})).toBe('idle');
            expect(phaseOf(IDLE_WATCH, RUNNING, {type: 'reset'})).toBe('waiting');
        });
    });

    describe('waiting', () => {
        const waiting = run(IDLE_WATCH, RUNNING).watch;

        it('makes the reply due, and reloads it at once, when the list shows the run done', () => {
            expect(run(waiting, DONE)).toMatchObject({
                watch: {phase: 'due', afterKey: 3},
                reload: true
            });
        });

        it('makes the reply due during a full load, and reloads once that load lands', () => {
            const due = run(waiting, {...DONE, isLoaded: false});
            expect(due).toMatchObject({watch: {phase: 'due'}, reload: false});

            expect(run(due.watch, DONE, loaded(3))).toMatchObject({
                watch: {phase: 'due'},
                reload: true
            });
        });

        it('reloads an empty history at each check, to show the turn once saved', () => {
            expect(run(waiting, RUNNING, {type: 'tick'}).reload).toBe(true);
            expect(run(waiting, {...RUNNING, history: 'question'}, {type: 'tick'}).reload).toBe(
                false
            );
            expect(run(waiting, RUNNING, {type: 'listed'}).reload).toBe(false);
            expect(run(waiting, {...RUNNING, isChecked: false}, {type: 'tick'}).reload).toBe(false);
        });

        it('stops checking at the timeout, and keeps sends waiting', () => {
            const late = run(waiting, {...RUNNING, now: 1000 + TIMEOUT}, {type: 'tick'});

            expect(late.watch).toMatchObject({phase: 'waiting', isTimedOut: true});
            expect(isRunningOnServer(late.watch, RUNNING)).toBe(true);
            expect(isWatchAutomatic(late.watch, RUNNING)).toBe(false);
        });

        it('goes idle once the history shows the reply', () => {
            expect(phaseOf(waiting, {...RUNNING, history: 'replied'})).toBe('idle');
        });
    });

    describe('due', () => {
        const due = run(run(IDLE_WATCH, RUNNING).watch, DONE).watch;

        it('goes idle once a reload brings the reply', () => {
            expect(phaseOf(due, {...DONE, history: 'replied'}, loaded(4))).toBe('idle');
        });

        it('retries at each check after a reload that failed, but not at once', () => {
            expect(run(due, DONE, failed(4))).toMatchObject({watch: {phase: 'due'}, reload: false});
            expect(run(due, DONE, {type: 'tick'}).reload).toBe(true);
            expect(run(due, DONE, {type: 'listed'}).reload).toBe(false);
        });

        it(`stops after ${DUE_RELOADS} reloads with no reply, as for a run that died`, () => {
            let watch = due;
            for (let i = 1; i < DUE_RELOADS; i++) {
                watch = run(watch, DONE, loaded(3 + i)).watch;
                expect(watch).toMatchObject({phase: 'due', misses: i});
            }
            watch = run(watch, DONE, loaded(3 + DUE_RELOADS)).watch;

            expect(watch.phase).toBe('stopped');
            expect(isRunningOnServer(watch, DONE)).toBe(false);
        });

        it('stops after one reload with no reply, when the model makes no checks', () => {
            expect(phaseOf(due, {...DONE, isChecked: false}, loaded(4))).toBe('stopped');
        });

        it('counts no reload that did not apply, and stops on a thread not found', () => {
            expect(run(due, DONE, loaded(4, false)).watch.misses).toBe(0);
            expect(phaseOf(due, DONE, failed(4, true))).toBe('stopped');
        });

        it('waits again on a turn that a later list shows running', () => {
            expect(phaseOf(due, RUNNING, {type: 'listed'})).toBe('waiting');
        });

        it('stops at the timeout of the turn it waited on', () => {
            expect(phaseOf(due, {...DONE, now: 1000 + TIMEOUT}, {type: 'tick'})).toBe('stopped');
        });
    });

    describe('settling', () => {
        const SETTLING = {...DONE, history: 'detached' as const},
            settling = run(IDLE_WATCH, SETTLING).watch;

        it('reloads at a check while no list shows the run going, and stops if nothing changed', () => {
            expect(run(settling, SETTLING, {type: 'listed'}).reload).toBe(false);
            expect(run(settling, SETTLING, {type: 'tick'}).reload).toBe(true);
            expect(phaseOf(settling, SETTLING, loaded(4))).toBe('stopped');
        });

        it('waits for a failure whose run a list shows going', () => {
            const failure = {...RUNNING, history: 'unsafeFailure' as const},
                watch = run(IDLE_WATCH, failure).watch;

            expect(run(watch, failure, {type: 'tick'}).reload).toBe(false);
            expect(phaseOf(watch, failure, loaded(4))).toBe('settling');
            expect(isRunningOnServer(watch, failure)).toBe(false);
        });

        it('waits on a detached reply that a list then shows running', () => {
            expect(phaseOf(settling, {...SETTLING, listedRunning: true}, {type: 'listed'})).toBe(
                'waiting'
            );
        });

        it('goes idle once the reply settles', () => {
            expect(phaseOf(settling, {...DONE, history: 'replied'}, loaded(4))).toBe('idle');
        });
    });

    describe('stopped', () => {
        const SETTLING = {...DONE, history: 'detached' as const},
            stopped = run(run(IDLE_WATCH, SETTLING).watch, SETTLING, loaded(4)).watch;

        it('stays stopped as lists that show no run come and go', () => {
            expect(run(stopped, SETTLING, {type: 'listed'}).watch).toBe(stopped);
            expect(run(stopped, SETTLING, {type: 'tick'})).toEqual({watch: stopped, reload: false});
        });

        it('wakes on a list that shows a turn running, with a fresh timeout', () => {
            const woken = run(
                stopped,
                {...SETTLING, listedRunning: true, now: 9000},
                {type: 'listed'}
            ).watch;
            expect(woken).toMatchObject({phase: 'waiting', since: 9000});
        });

        it('goes idle once the history shows the reply', () => {
            expect(phaseOf(stopped, {...DONE, history: 'replied'}, loaded(5))).toBe('idle');
        });
    });

    describe('reloads', () => {
        it('never asks for a reload while another runs, or before the history loads', () => {
            const waiting = run(IDLE_WATCH, RUNNING).watch,
                due = run(waiting, DONE).watch,
                started = run(due, DONE, {type: 'reloadStarted', key: 4}).watch;

            expect(started.reloadKey).toBe(4);
            expect(run(started, DONE, {type: 'tick'}).reload).toBe(false);
            expect(run(due, {...DONE, isLoaded: false}, {type: 'tick'}).reload).toBe(false);
            // Its own end frees the way for the next.
            expect(run(started, DONE, failed(4)).watch.reloadKey).toBeNull();
        });
    });

    describe('isRunningOnServer and isWatchAutomatic', () => {
        it('reads sends waiting from the phase alone', () => {
            const waiting = run(IDLE_WATCH, RUNNING).watch,
                due = run(waiting, DONE).watch;

            expect(isRunningOnServer(waiting, RUNNING)).toBe(true);
            expect(isRunningOnServer(due, DONE)).toBe(true);
            expect(isRunningOnServer(IDLE_WATCH, RUNNING)).toBe(false);
            expect(isRunningOnServer(waiting, {...RUNNING, isLoadFailed: true})).toBe(false);
        });

        it('checks on its own only for a thread the current list holds', () => {
            const waiting = run(IDLE_WATCH, RUNNING).watch;

            expect(isWatchAutomatic(waiting, RUNNING)).toBe(true);
            expect(isWatchAutomatic(waiting, {...RUNNING, isChecked: false})).toBe(false);
        });
    });

    //------------------
    // Helpers
    //------------------
    function run(watch: RunWatch, facts: RunFacts, event: RunWatchEvent = {type: 'listed'}) {
        return stepRunWatch(watch, facts, event, TIMEOUT);
    }

    function phaseOf(watch: RunWatch, facts: RunFacts, event?: RunWatchEvent) {
        return run(watch, facts, event).watch.phase;
    }

    function loaded(key: number, isApplied: boolean = true): RunWatchEvent {
        return {type: 'loaded', key, isApplied};
    }

    function failed(key: number, isNotFound: boolean = false): RunWatchEvent {
        return {type: 'loadFailed', key, isNotFound};
    }
});

// A thread the list shows running, with an empty history.
const RUNNING: RunFacts = {
    isBusy: false,
    isSaved: true,
    isLoaded: true,
    isLoadFailed: false,
    isChecked: true,
    listedRunning: true,
    history: 'empty',
    loadKey: 3,
    now: 1000
};

// The same thread once the list shows its run done.
const DONE: RunFacts = {...RUNNING, listedRunning: false};
