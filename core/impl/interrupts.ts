import {buildResumeArray, isInterruptExpired} from '@ag-ui/client';
import type {ResumeEntry} from '@ag-ui/core';
import {findLast, isEmpty, last, omit} from 'lodash';
import type {ChatInterrupt, ChatInterruptResponse} from '../ChatInterrupt';
import type {ChatMessage} from '../ChatMessage';

/**
 * The interrupts of the thread's last interrupted run that no finished run has answered yet - the
 * set the next request must cover. Ids are unique only within a run, so the set names its run.
 * @internal
 */
export interface InterruptSet {
    /** The reply that holds the interrupted run. */
    messageId: string;

    /** The run that raised the interrupts. */
    runId: string;

    interrupts: ChatInterrupt[];

    /** True once the user submitted the responses, or the chat declined the rest for them. */
    isSubmitted: boolean;
}

/**
 * The set of a reply's interrupts from one run that are not yet delivered, or null.
 * @internal
 */
export function createInterruptSet(message: ChatMessage, runId: string): InterruptSet {
    const interrupts = getInterrupts(message).filter(
        it => it.runId === runId && it.delivered === false
    );
    return isEmpty(interrupts)
        ? null
        : {messageId: message.id, runId, interrupts, isSubmitted: false};
}

/**
 * The set to restore with a loaded history: the undelivered interrupts of the last reply, from
 * its last interrupted run. Only an interrupt the chat recorded as `delivered: false` counts, as a
 * store may report past interrupts with no delivery flag. Null if none.
 * @internal
 */
export function restoreInterruptSet(messages: ChatMessage[]): InterruptSet {
    const message = findLast(messages, it => it.isAssistant),
        undelivered = getInterrupts(message).filter(it => it.delivered === false);
    return isEmpty(undelivered) ? null : createInterruptSet(message, last(undelivered).runId);
}

/** A reply's interrupts, from its `metadata.interrupts`. @internal */
export function getInterrupts(message: ChatMessage): ChatInterrupt[] {
    return (message?.isAssistant && message.metadata.interrupts) || [];
}

/** True if an interrupt is past its `expiresAt`. @internal */
export function isExpired(interrupt: ChatInterrupt, now: Date = new Date()): boolean {
    return isInterruptExpired(interrupt, now);
}

/**
 * True if every interrupt of the set has a response, counting an expired one as declined.
 * @internal
 */
export function hasAllResponses(set: InterruptSet, now: Date = new Date()): boolean {
    return set.interrupts.every(it => it.response != null || isExpired(it, now));
}

/** The set with one interrupt's response. @internal */
export function withResponse(
    set: InterruptSet,
    interruptId: string,
    response: ChatInterruptResponse
): InterruptSet {
    return {
        ...set,
        interrupts: set.interrupts.map(it => (it.id === interruptId ? {...it, response} : it))
    };
}

/**
 * The set with each interrupt that has no response declined, and submitted - for a user who
 * moved on. With `isStopped`, answers become declines too, for a resumed run the user stopped,
 * so an answer that may have reached the server never goes twice.
 * @internal
 */
export function declineRest(set: InterruptSet, isStopped: boolean = false): InterruptSet {
    const declined: ChatInterruptResponse = {status: 'cancelled', declinedBy: 'skipped'};
    return {
        ...set,
        isSubmitted: true,
        interrupts: set.interrupts.map(it =>
            it.response == null || (isStopped && it.response.status === 'resolved')
                ? {...it, response: declined}
                : it
        )
    };
}

/** The set, delivered. @internal */
export function markDelivered(set: InterruptSet): InterruptSet {
    return {...set, interrupts: set.interrupts.map(it => ({...it, delivered: true}))};
}

/**
 * The AG-UI resume list for a submitted set, built with the official client's helper, which
 * throws if an interrupt has no entry. An interrupt past its `expiresAt` goes as `cancelled`, as
 * AG-UI requires, whatever the user answered.
 * @internal
 */
export function buildResume(set: InterruptSet, now: Date = new Date()): ResumeEntry[] {
    const responses = Object.fromEntries(
        set.interrupts.map(it => {
            const {response} = it;
            return [
                it.id,
                response?.status === 'resolved' && !isExpired(it, now)
                    ? {status: 'resolved' as const, payload: response.payload}
                    : {status: 'cancelled' as const}
            ];
        })
    );
    return buildResumeArray(
        set.interrupts.map(it => omit(it, ['runId', 'step', 'response', 'delivered'])),
        responses
    );
}

/**
 * A reply with the set's interrupts written back to its `metadata.interrupts`, matched by run and
 * id. Other interrupts of the reply are left as they are. A server call whose approval was declined
 * shows as denied, with no result for the server.
 * @internal
 */
export function writeInterrupts(message: ChatMessage, set: InterruptSet): ChatMessage {
    const byKey = new Map(set.interrupts.map(it => [`${it.runId}:${it.id}`, it])),
        current = getInterrupts(message);
    if (current.every(it => !byKey.has(`${it.runId}:${it.id}`))) return message;

    const declined = new Map(
            set.interrupts
                .filter(it => it.toolCallId != null && it.response?.status === 'cancelled')
                .map(it => [it.toolCallId, it.response.declinedBy])
        ),
        parts = message.parts.map(part =>
            part.type === 'toolCall' &&
            part.awaitsResume &&
            part.resultServerId == null &&
            part.state !== 'output-denied' &&
            declined.has(part.id)
                ? {
                      ...part,
                      state: 'output-denied' as const,
                      errorText: declined.get(part.id) ? 'Skipped.' : 'Declined.',
                      endedAt: Date.now()
                  }
                : part
        );
    return message.withChanges({
        parts,
        metadata: {
            ...message.metadata,
            interrupts: current.map(it => byKey.get(`${it.runId}:${it.id}`) ?? it)
        }
    });
}
