/**
 * Listeners for `ChatKit.clearLocalData()`, for what the kit keeps in memory for the session -
 * such as the draft of an open feedback form. Each gets the thread ids to clear, or null for all.
 */
const listeners = new Set<(threadIds: string[]) => void>();

/**
 * Clear data kept in memory along with the local data - see `ChatKit.clearLocalData()`.
 * @internal
 */
export function onClearLocalData(listener: (threadIds: string[]) => void) {
    listeners.add(listener);
}

/**
 * Tell the listeners to clear their data, for some threads or for all.
 * @internal
 */
export function notifyClearLocalData(threadIds: string[]) {
    listeners.forEach(it => it(threadIds));
}
