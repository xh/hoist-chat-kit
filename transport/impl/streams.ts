import {noop} from 'lodash';

/**
 * Iterate `source` until it ends or `signal` aborts. An abort ends iteration at once - throwing
 * the signal's reason - even while a read is pending, so a silent backend cannot delay a stop.
 * The source is closed when iteration ends for any reason.
 * @internal
 */
export async function* abortable<T>(
    source: AsyncIterator<T>,
    signal: AbortSignal
): AsyncGenerator<T> {
    try {
        while (true) {
            const {done, value} = await raceAbort(source.next(), signal);
            if (done) return;
            yield value;
        }
    } finally {
        // Not awaited - a read abandoned by an abort settles only once its request is cancelled.
        source.return?.().catch(noop);
    }
}

//------------------
// Implementation
//------------------
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
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
