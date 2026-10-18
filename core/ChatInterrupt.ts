import type {Interrupt} from '@ag-ui/core';

/**
 * A question, or a request to run a tool, that a server agent raised by ending its run with an
 * AG-UI `interrupt` outcome. The reply that holds the run records each one in its
 * `metadata.interrupts`, with the user's response. The chat answers the open ones in the next run's
 * `resume` list - see `ChatModel.openInterrupts`.
 *
 * The AG-UI fields: `id`, unique within its run, and `reason`, an open string. Optionally a
 * `message` to show, a `toolCallId` for a request to run a tool, a `responseSchema` for the answer,
 * an `expiresAt`, a `subagentRunId` and `metadata`.
 */
export interface ChatInterrupt extends Interrupt {
    /** The run that raised it. Ids are unique only within a run. */
    runId: string;

    /** The step of the reply whose run raised it, so that views show it after that step. */
    step: number;

    /** How the user, or the chat for them, dealt with it - null until then. */
    response: ChatInterruptResponse;

    /** True once a run that carried the response has finished. */
    delivered: boolean;
}

/** The response to a {@link ChatInterrupt}, sent as an AG-UI resume entry. */
export interface ChatInterruptResponse {
    /** `resolved` for an answer, `cancelled` for a decline. A denied approval is an answer. */
    status: 'resolved' | 'cancelled';

    /** The answer, for `resolved`. */
    payload?: unknown;

    /**
     * Why the chat declined it for the user, when it did: `expired`, past its `expiresAt`, or
     * `skipped`, when the user moved on or stopped. Absent for the user's own response.
     */
    declinedBy?: 'expired' | 'skipped';
}
