/**
 * What the threads model knows of a turn that runs on the server while a thread's chat does not
 * follow it, as after a page reload. One record per open thread, changed only by
 * {@link stepRunWatch}, a pure function of the record, the thread's facts and one event. The
 * model reads all its answers - whether sends wait, whether it checks on its own, whether to
 * reload the history now - from the record and the facts, never from flags of its own.
 *
 * Phases:
 *
 *  - `idle` - nothing to check on.
 *  - `waiting` - the list shows the thread running, and its history holds no reply to the turn.
 *    Checks reload the list, and the history too while it is empty.
 *  - `reloading` - the reply is due: a list showed a waited-on turn done, or the last reply may
 *    still change on the server. A history load begun from now on settles it. A thread that was
 *    waiting still reads as waiting until then.
 *  - `stopped` - the model gave up checking, at `timeoutMs` or on a reload that settled nothing.
 *    The user refreshes by hand.
 * @internal
 */
export interface RunWatch {
    phase: 'idle' | 'waiting' | 'reloading' | 'stopped';

    /** When the model began to check on the turn, for the timeout. Null while idle. */
    since: number;

    /** In `reloading`: the load key at its start. A load with a higher key settles it. */
    reloadAfter: number;

    /** In `reloading`: true if the thread was waiting, and so reads as waiting until it settles. */
    isAwaiting: boolean;

    /** True while a reload that the watch asked for runs. */
    isReloading: boolean;

    /**
     * True if a list showed the turn running since the watch began - so that a later list that
     * shows it done brings its reply, from any phase.
     */
    seenRunning: boolean;
}

/**
 * What the threads model reads from a thread at each step.
 * @internal
 */
export interface RunFacts {
    /** True while the chat runs a turn of its own. */
    isBusy: boolean;

    /** True once the thread's history has loaded. */
    isLoaded: boolean;

    /** True if the thread's history failed to load, or the thread does not exist. */
    isLoadFailed: boolean;

    /** The `isRunning` of the last list that held the thread, or null if none has. */
    listedRunning: boolean;

    /** True if the history is empty. */
    isEmpty: boolean;

    /**
     * True if the history holds no reply to its latest turn: it is empty, ends with the user's
     * message, or ends with a reply left running.
     */
    lacksReply: boolean;

    /**
     * True if the last reply may yet change on the server: left running, or failed in a way that
     * is not retry-safe.
     */
    isUnsettled: boolean;

    /** The thread's latest load key. */
    loadKey: number;

    now: number;
}

/**
 * An event that a watch steps on.
 *
 *  - `changed` - the facts may have changed: a list applied, or a turn ended.
 *  - `loaded` - a history load with this key applied.
 *  - `tick` - a check, after its list reload.
 *  - `reloadStarted`, `reloadEnded` - a reload the watch asked for began or ended.
 *  - `reset` - the chat holds another thread, or none.
 * @internal
 */
export type RunWatchEvent =
    | {type: 'changed'}
    | {type: 'loaded'; key: number}
    | {type: 'tick'}
    | {type: 'reloadStarted'}
    | {type: 'reloadEnded'}
    | {type: 'reset'};

/** @internal */
export const IDLE_WATCH: RunWatch = Object.freeze({
    phase: 'idle',
    since: null,
    reloadAfter: null,
    isAwaiting: false,
    isReloading: false,
    seenRunning: false
});

/**
 * The watch after an event. Returns the same record if nothing changed.
 *
 * @param timeoutMs - how long the model checks on a turn before it stops.
 * @internal
 */
export function stepRunWatch(
    watch: RunWatch,
    facts: RunFacts,
    event: RunWatchEvent,
    timeoutMs: number
): RunWatch {
    if (event.type === 'reset' || facts.isBusy) return IDLE_WATCH;
    if (event.type === 'reloadStarted') return {...watch, isReloading: true};
    if (event.type === 'reloadEnded') return {...watch, isReloading: false};

    const {listedRunning, lacksReply, isUnsettled, loadKey, now} = facts,
        isListedRunning = listedRunning === true && lacksReply,
        start = (w: Partial<RunWatch>): RunWatch => ({
            ...IDLE_WATCH,
            since: watch.since ?? now,
            isReloading: watch.isReloading,
            seenRunning: watch.seenRunning || listedRunning === true,
            ...w
        }),
        // A list shows done a turn that one before it showed running, and no reply has loaded.
        isNowDone = watch.seenRunning && listedRunning === false && lacksReply,
        dueReply = () =>
            start({
                phase: 'reloading',
                since: now,
                reloadAfter: loadKey,
                isAwaiting: true,
                seenRunning: false
            });

    // A load begun since the reply fell due settles it. What the history then holds decides the
    // rest: a turn still running waits again, a reply that still may change is not one a later
    // check would settle, and a reply not yet saved stays due, for the next check to reload.
    if (event.type === 'loaded' && watch.phase === 'reloading' && event.key > watch.reloadAfter) {
        if (isListedRunning) return start({phase: 'waiting', seenRunning: true});
        if (isUnsettled) return start({phase: 'stopped', seenRunning: false});
        if (lacksReply && watch.isAwaiting) return {...watch, reloadAfter: event.key};
        return idle(watch);
    }

    switch (watch.phase) {
        case 'idle':
            if (isListedRunning) return start({phase: 'waiting', since: now, seenRunning: true});
            // A reply that may still change reloads once the list no longer shows its run going.
            if (isUnsettled) return start({phase: 'reloading', since: now, reloadAfter: loadKey});
            return watch;

        case 'waiting':
            if (!lacksReply) return idle(watch);
            if (isNowDone) return dueReply();
            return isTimedOut(watch, facts, event, timeoutMs) ? start({phase: 'stopped'}) : watch;

        case 'reloading':
            if (!lacksReply && !isUnsettled) return idle(watch);
            return isTimedOut(watch, facts, event, timeoutMs) ? start({phase: 'stopped'}) : watch;

        case 'stopped':
            if (!lacksReply && !isUnsettled) return idle(watch);
            // Stopped checks still hear a list: a turn it shows done brings its reply.
            if (isNowDone) return dueReply();
            return listedRunning === true && !watch.seenRunning
                ? {...watch, seenRunning: true}
                : watch;
    }
}

/**
 * True if the server runs a turn of the thread that its chat does not follow, and the thread
 * has no reply to it yet - sends then wait, and the chat shows the reply on its way.
 * @internal
 */
export function isRunningOnServer(watch: RunWatch, facts: RunFacts): boolean {
    if (facts.isBusy || facts.isLoadFailed) return false;
    if (watch.phase === 'reloading' && watch.isAwaiting) return true;
    return facts.listedRunning === true && facts.lacksReply;
}

/**
 * True while the model checks on the turn on its own, so that the user need not.
 * @internal
 */
export function isWatchActive(watch: RunWatch): boolean {
    return watch.phase === 'waiting' || watch.phase === 'reloading';
}

/**
 * True if the model should reload the thread's history quietly now, after this event:
 *
 *  - A reply that fell due as a list showed the turn done - at once, and again at each check
 *    if a load failed.
 *  - A reply that may still change - at a check, once the list no longer shows the run going.
 *  - A waited-on thread with no messages yet - at each check, so that the turn shows once saved.
 *
 * Never while another reload the watch asked for runs, or before the history first loads.
 * @internal
 */
export function shouldReload(watch: RunWatch, facts: RunFacts, event: RunWatchEvent): boolean {
    if (watch.isReloading || !facts.isLoaded || facts.isBusy) return false;
    const isCheck = event.type === 'tick';
    switch (watch.phase) {
        case 'reloading':
            if (watch.isAwaiting) return isCheck || event.type !== 'reloadEnded';
            return isCheck && facts.listedRunning !== true;
        case 'waiting':
            return isCheck && facts.isEmpty;
        default:
            return false;
    }
}

//------------------
// Implementation
//------------------
function idle(watch: RunWatch): RunWatch {
    return watch.isReloading ? {...IDLE_WATCH, isReloading: true} : IDLE_WATCH;
}

function isTimedOut(
    watch: RunWatch,
    facts: RunFacts,
    event: RunWatchEvent,
    timeoutMs: number
): boolean {
    return event.type === 'tick' && watch.since != null && facts.now - watch.since >= timeoutMs;
}
