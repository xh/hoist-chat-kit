import {XH} from '@xh/hoist/core';

/**
 * Generate an id for a thread, run, message or part. Ids may travel to a backend and into stored
 * history, so they are UUIDs where the browser supports them, rather than Hoist's run-local ids.
 * @internal
 */
export function genChatId(): string {
    return globalThis.crypto?.randomUUID?.() ?? XH.genId();
}
