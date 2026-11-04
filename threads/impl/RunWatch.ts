/**
 * What the threads model knows of a turn that runs on the server while a thread's chat does not
 * follow it, as after a page reload. One record per open thread, changed only by
 * {@link stepRunWatch}: a pure function of the record, the thread's facts and one event, which
 * returns the next record and whether to reload the thread's history now. The record's phase
 * alone answers whether sends wait, and with the facts, whether the model checks on its own.
 *
 * Phases:
 *
 *  - `idle` - nothing to check on.
 *  - `waiting` - a list shows the thread running, and its history holds no reply to the turn.
 *    Sends wait. Checks reload the list, and the history too while it is empty.
 *  - `due` - a list showed done the turn the thread waited on, so its reply is due. Sends still
 *    wait, until a reload brings the reply. If a few reloads find none, the run died.
 *  - `settling` - the last reply may still change on the server: it was left running, or failed
 *    in a way that is not retry-safe, and no list shows a turn running. Sends do not wait. A check
 *    reloads the history once no list shows the run going. If the reload leaves the reply as it
 *    was, the run died.
 *  - `stopped` - the run died, or the watch timed out. The user refreshes by hand. A list that
 *    shows a turn running wakes the watch.
 * @internal
 */
export interface RunWatch {
    phase: 'idle' | 'waiting' | 'due' | 'settling' | 'stopped';

    /** When the phase's watch began, for the timeout. Null while idle. */
    since: number;

    /** The load key as the phase began. Only a load with a higher key settles it. */
    afterKey: number;

    /** In `due`: the reloads since it began that applied and still found no reply. */
    misses: number;

    /** In `waiting`: true once it timed out, so that the model no longer checks on its own. */
    isTimedOut: boolean;

    /** The key of the reload the watch asked for, while it runs, or null. */
    reloadKey: number;
}

/**
 * What a thread's history ends with, as the run watch reads it:
 *
 *  - `replied` - a reply that will not change.
 *  - `empty` - nothing, as before a backend saves a thread's first turn.
 *  - `question` - the user's message, with no reply yet.
 *  - `detached` - a reply left running on the server.
 *  - `unsafeFailure` - a reply that failed in a way that is not retry-safe.
 * @internal
 */
export type RunHistory = 'replied' | 'empty' | 'question' | 'detached' | 'unsafeFailure';

/**
 * What the threads model reads from a thread at each step.
 * @internal
 */
export interface RunFacts {
    /** True while the chat runs a turn of its own. */
    isBusy: boolean;

    /** True if the backend may hold the thread: one loaded, or whose first turn reached it. */
    isSaved: boolean;

    /** True once the thread's history has loaded. */
    isLoaded: boolean;

    /** True if the thread's history failed to load, or the thread does not exist. */
    isLoadFailed: boolean;

    /**
     * True if the model checks on threads on its own, and the current list holds this one, so
     * that a check can see its run end.
     */
    isChecked: boolean;

    /** The `isRunning` of the last list that held the thread, or null if none has. */
    listedRunning: boolean;

    history: RunHistory;

    /** The thread's latest load key. */
    loadKey: number;

    now: number;
}

/**
 * An event that a watch steps on.
 *
 *  - `listed` - a list that holds the thread applied, or the thread opened from one.
 *  - `turn` - the chat's own turn started or ended.
 *  - `loaded` - the history load with this key ended. `isApplied` is false if it was superseded,
 *    or did not apply over a change the user made.
 *  - `loadFailed` - the history load with this key failed.
 *  - `reloadStarted` - the reload the watch asked for began, with this key.
 *  - `tick` - a check, after its list reload.
 *  - `reset` - the chat holds another thread, or none.
 * @internal
 */
export type RunWatchEvent =
    | {type: 'listed'}
    | {type: 'turn'}
    | {type: 'loaded'; key: number; isApplied: boolean}
    | {type: 'loadFailed'; key: number; isNotFound: boolean}
    | {type: 'reloadStarted'; key: number}
    | {type: 'tick'}
    | {type: 'reset'};

/**
 * A step's result: the next watch, and whether to reload the history now.
 * @internal
 */
export interface RunWatchStep {
    watch: RunWatch;
    reload: boolean;
}

/** @internal */
export const IDLE_WATCH: RunWatch = Object.freeze({
    phase: 'idle',
    since: null,
    afterKey: null,
    misses: 0,
    isTimedOut: false,
    reloadKey: null
});

/**
 * Reloads of a due reply that may find none before the watch decides that the run died - room
 * for a backend that marks a run done a moment before it saves the reply. Without checks, one.
 * @internal
 */
export const DUE_RELOADS = 3;

/**
 * Step a watch on an event - the one place a watch changes, and the one place that decides to
 * reload a history for it.
 *
 * @param timeoutMs - how long the model checks on a turn before it stops.
 * @internal
 */
export function stepRunWatch(
    watch: RunWatch,
    facts: RunFacts,
    event: RunWatchEvent,
    timeoutMs: number
): RunWatchStep {
    const {isLoaded, isChecked, listedRunning, history, loadKey, now} = facts;
    if (facts.isBusy) return {watch: IDLE_WATCH, reload: false};
    if (event.type === 'reloadStarted') {
        return {watch: {...watch, reloadKey: event.key}, reload: false};
    }

    // The reload the watch asked for ends with its load.
    const isEnd = event.type === 'loaded' || event.type === 'loadFailed',
        w = isEnd && event.key === watch.reloadKey ? {...watch, reloadKey: null} : watch,
        lacksReply = history === 'empty' || history === 'question' || history === 'detached',
        mayChange = history === 'detached' || history === 'unsafeFailure',
        isRunning = listedRunning === true && lacksReply,
        isLater = isEnd && event.key > w.afterKey,
        isLate = event.type === 'tick' && w.since != null && now - w.since >= timeoutMs,
        result = (next: RunWatch, reload: boolean): RunWatchStep => ({
            watch: next,
            reload: reload && isLoaded && next.reloadKey == null
        }),
        stay = (reload: boolean = false, changes: Partial<RunWatch> = {}) =>
            result(hasChanges(w, changes) ? {...w, ...changes} : w, reload),
        enter = (phase: RunWatch['phase'], reload: boolean = false) =>
            result(
                phase === 'idle'
                    ? IDLE_WATCH
                    : {
                          ...IDLE_WATCH,
                          phase,
                          // A due reply belongs to the turn its thread waited on.
                          since: phase === 'due' ? (w.since ?? now) : now,
                          afterKey: loadKey,
                          reloadKey: w.reloadKey
                      },
                reload
            ),
        // What the facts call for, with no watch running.
        classify = (): RunWatchStep => {
            if (!facts.isSaved || facts.isLoadFailed) return enter('idle');
            if (isRunning) return enter('waiting');
            return enter(mayChange ? 'settling' : 'idle');
        };

    if (event.type === 'reset') return classify();

    switch (w.phase) {
        case 'idle':
            return classify();

        case 'waiting':
            if (!lacksReply) return classify();
            // The list shows the run done: its reply is due, at once.
            if (listedRunning === false) return enter('due', true);
            if (event.type !== 'tick' || !isChecked) return stay();
            if (isLate) return stay(false, {isTimedOut: true});
            return stay(!w.isTimedOut && history === 'empty');

        case 'due':
            if (history === 'replied') return enter('idle');
            if (event.type === 'listed' && isRunning) return enter('waiting');
            // A full load that began before the reply fell due: reload once it lands.
            if (isEnd && !isLater) return stay(event.type === 'loaded');
            if (event.type === 'loaded' && event.isApplied) {
                const misses = w.misses + 1;
                return misses >= (isChecked ? DUE_RELOADS : 1)
                    ? enter('stopped')
                    : stay(false, {misses});
            }
            if (event.type === 'loadFailed' && event.isNotFound) return enter('stopped');
            if (event.type !== 'tick' || !isChecked) return stay();
            return isLate ? enter('stopped') : stay(true);

        case 'settling':
            if (!mayChange) return classify();
            if (isRunning) return enter('waiting');
            if (event.type === 'loaded' && event.isApplied && isLater) {
                // A reload that left the reply as it was, with no run listed: the run died.
                return listedRunning === true ? stay() : enter('stopped');
            }
            if (event.type === 'loadFailed' && event.isNotFound && isLater) {
                return enter('stopped');
            }
            if (event.type !== 'tick' || !isChecked) return stay();
            if (isLate) return enter('stopped');
            return stay(listedRunning !== true);

        case 'stopped':
            if (history === 'replied' || !facts.isSaved) return enter('idle');
            // A list that shows a turn running wakes the watch.
            if (event.type === 'listed' && isRunning) return enter('waiting');
            return stay();
    }
}

/**
 * True if the server runs a turn of the thread that its chat does not follow, and the thread
 * has no reply to it yet - sends then wait, and the chat shows the reply on its way.
 * @internal
 */
export function isRunningOnServer(watch: RunWatch, facts: RunFacts): boolean {
    if (facts.isBusy || facts.isLoadFailed) return false;
    return watch.phase === 'waiting' || watch.phase === 'due';
}

/**
 * True while the model checks on the turn on its own, so that the user need not refresh it.
 * @internal
 */
export function isWatchAutomatic(watch: RunWatch, facts: RunFacts): boolean {
    if (!facts.isChecked || facts.isBusy) return false;
    switch (watch.phase) {
        case 'waiting':
            return !watch.isTimedOut;
        case 'due':
        case 'settling':
            return true;
        default:
            return false;
    }
}

//------------------
// Implementation
//------------------
function hasChanges(watch: RunWatch, changes: Partial<RunWatch>): boolean {
    return Object.entries(changes).some(([key, value]) => watch[key] !== value);
}
