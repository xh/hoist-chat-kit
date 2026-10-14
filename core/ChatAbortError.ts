/**
 * Why a turn stopped before its end - the `reason` of the {@link ChatAbortError} that aborts its
 * signal.
 *
 *  - `stop` - the user stopped the turn. The chat asks the transport to cancel the run.
 *  - `detach` - the app stopped following the turn, and leaves it running on the server.
 *  - `clear` - the conversation was cleared.
 *  - `load` - other messages were loaded in its place.
 *  - `destroy` - the chat was destroyed.
 */
export type ChatAbortReason = 'stop' | 'detach' | 'clear' | 'load' | 'destroy';

/**
 * The reason a {@link ChatModel} gives when it aborts the signal of a turn - passed to the
 * transport on `ChatRunRequest.signal`, and to client tools on `ChatToolContext.signal`.
 *
 * Its `name` is `AbortError`, so code that checks for an abort, including Hoist's `FetchService`,
 * treats it as one. A transport reads `reason` to tell a stop - after which the run should end -
 * from a detach, a clear or a load, after which a server that owns the conversation may finish
 * the run on its own.
 */
export class ChatAbortError extends Error {
    /** Why the turn stopped. */
    readonly reason: ChatAbortReason;

    constructor(reason: ChatAbortReason) {
        super(`Chat turn aborted - ${reason}.`);
        this.name = 'AbortError';
        this.reason = reason;
    }
}
