import {compact, isEmpty} from 'lodash';
import {fmtDateTime} from '@xh/hoist/format';
import type {ChatMessage} from '../../../../core';

/**
 * True for a reply that failed before its run started - for example offline, or a failed thread
 * create - so that the turn's message was never sent. Such a reply has no parts, no run id from
 * the server, and no error code from a run. The user message shows "Not sent" in its place.
 * @internal
 */
export function isReplyNotSent(reply: ChatMessage): boolean {
    if (!reply?.isAssistant || reply.status !== 'error' || !isEmpty(reply.parts)) return false;
    const {runId, errorCode} = reply.metadata;
    return runId == null && errorCode == null;
}

/**
 * The cause of a failed reply, in words for the user.
 * @internal
 */
export function getFailureCause(reply: ChatMessage): string {
    return reply?.error || 'Something went wrong.';
}

/**
 * Details of a failed reply to copy for a support request: the cause, its error code, the ids
 * that find the run on the server, and the time.
 * @internal
 */
export function formatFailureDetails(reply: ChatMessage): string {
    const {errorCode, runId, serverId} = reply.metadata,
        endedAt = reply.createdAt + (reply.metadata.elapsedMs ?? 0);
    return compact([
        `The reply failed: ${getFailureCause(reply)}`,
        errorCode ? `Code: ${errorCode}` : null,
        runId ? `Run: ${runId}` : null,
        serverId ? `Message: ${serverId}` : null,
        `Time: ${fmtDateTime(endedAt) as string}`
    ]).join('\n');
}
