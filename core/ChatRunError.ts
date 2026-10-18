/**
 * Error for a turn that failed - the {@link ChatModel.lastError} of a run that reported an error
 * of its own, or whose stream ended before it was complete.
 *
 * Its `code` tells apps a retryable failure (such as Anthropic's `overloaded_error`) from a fatal
 * one. The same code is recorded on the message, as `metadata.errorCode`.
 */
export class ChatRunError extends Error {
    /**
     * Machine-readable error code - the backend's (an AG-UI `RUN_ERROR` code, or the Anthropic
     * error type), `incomplete-stream` for a stream that ended early, `empty-response` for a run
     * that finished with no content, `stalled` for a stream that sent nothing for longer than
     * the transport's `idleTimeout`, `invalid-stream` for an AG-UI stream that broke the spec's
     * rules, or `invalid-request` for an AG-UI request that failed the spec's check before it
     * went. Null if none was given.
     */
    readonly code: string;

    /**
     * Seconds the backend asks the client to wait before it retries, from the `metadata` of its
     * `RUN_ERROR` - for example while an earlier attempt at the same turn still runs. Recorded on
     * the message as `metadata.retryAfterSeconds`. Null if the backend gave none.
     */
    readonly retryAfterSeconds: number;

    constructor(message: string, code: string = null, retryAfterSeconds: number = null) {
        super(message);
        this.name = 'ChatRunError';
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}
