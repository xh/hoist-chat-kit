import type {ChatModel} from '../../../core';

/**
 * Bounds the tool calls that the OpenUI Lang programs of one chat make. A program has a cap of
 * its own on its `Query()` statements. A reply can hold many programs, and each can refresh on
 * a timer, so two more bounds hold across programs:
 *
 * - Only the first few programs of a message that hold queries may run them.
 * - All the programs of a chat together start at most a set number of calls per minute.
 * @internal
 */
export class OpenUiCallBudget {
    // The programs of each message that may run queries, by message id.
    private readonly programs = new Map<string, Set<object>>();

    // When each call of the last minute started, oldest first.
    private calls: number[] = [];

    /**
     * True if a program may run its queries: it is one of the first few programs of its message
     * to ask. A program that was admitted stays so until it is released.
     */
    admit(messageId: string, program: object): boolean {
        const {programs} = this,
            admitted = programs.get(messageId) ?? new Set<object>();
        if (admitted.has(program)) return true;
        if (admitted.size >= MAX_QUERY_PROGRAMS) return false;
        admitted.add(program);
        programs.set(messageId, admitted);
        return true;
    }

    /** Give up the place of a program that goes away. */
    release(messageId: string, program: object) {
        const admitted = this.programs.get(messageId);
        admitted?.delete(program);
        if (admitted?.size === 0) this.programs.delete(messageId);
    }

    /**
     * Count one call that is about to start. False if the chat already started as many calls in
     * the last minute as it may, in which case the call must not run.
     */
    take(maxPerMinute: number): boolean {
        const now = Date.now();
        this.calls = this.calls.filter(it => now - it < MINUTE);
        if (this.calls.length >= maxPerMinute) return false;
        this.calls.push(now);
        return true;
    }
}

/** The budget of a chat. One per `ChatModel`, for as long as the chat lives. @internal */
export function getCallBudget(chatModel: ChatModel): OpenUiCallBudget {
    let ret = budgets.get(chatModel);
    if (!ret) {
        ret = new OpenUiCallBudget();
        budgets.set(chatModel, ret);
    }
    return ret;
}

/** Most programs of one message that may run queries. @internal */
export const MAX_QUERY_PROGRAMS = 3;

//------------------
// Implementation
//------------------
const MINUTE = 60_000,
    budgets = new WeakMap<ChatModel, OpenUiCallBudget>();
