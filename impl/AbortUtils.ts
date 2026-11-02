import {noop} from 'lodash';

/**
 * Settle as `promise` does, or reject with the signal's reason as soon as `signal` aborts - so that
 * a caller stops waiting on work that ignores the signal. The abort listener is removed once the
 * race settles.
 * @internal
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            promise.catch(noop);
            reject(signal.reason);
            return;
        }
        const onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, {once: true});
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

/**
 * Wait `ms` milliseconds, or reject with the signal's reason - and clear the timer - if it aborts
 * first.
 * @internal
 */
export function sleepAsync(ms: number, signal: AbortSignal): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    const elapsed = new Promise<void>(resolve => (timer = setTimeout(resolve, ms)));
    return raceAbort(elapsed, signal).finally(() => clearTimeout(timer));
}

/**
 * True for the error of an aborted operation - a DOM `AbortError`, or a Hoist `FetchException`
 * for an aborted request.
 * @internal
 */
export function isAbortError(e: any): boolean {
    return e?.name === 'AbortError' || e?.isFetchAborted === true;
}
