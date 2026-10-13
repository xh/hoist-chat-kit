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
     * error type), or `incomplete-stream` for a stream that ended early. Null if none was given.
     */
    readonly code: string;

    constructor(message: string, code: string = null) {
        super(message);
        this.name = 'ChatRunError';
        this.code = code;
    }
}
