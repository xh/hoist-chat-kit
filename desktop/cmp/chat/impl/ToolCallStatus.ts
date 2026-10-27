import type {ReactElement, ReactNode} from 'react';
import {span} from '@xh/hoist/cmp/layout';
import {Icon} from '@xh/hoist/icon';
import type {ChatToolCallPart, ChatToolCallState, ChatToolSpec} from '../../../../core';
import {humanizeToolName} from './ChatFormat';
import {chatSpinner} from '../../../impl/ChatLiveCues';

/**
 * True for a call that a person needs to answer - an interactive tool with no result yet.
 * @internal
 */
export function isAwaitingAnswer(part: ChatToolCallPart, spec: ChatToolSpec): boolean {
    return part.state === 'input-available' && !!spec?.interactive && !spec.execute;
}

/**
 * Title of a call, from its spec or its tool name.
 * @internal
 */
export function getToolTitle(part: ChatToolCallPart, spec: ChatToolSpec): string {
    return spec?.displayName ?? humanizeToolName(part.toolName);
}

/**
 * The kind of status a call shows, which sets its row's color: busy while it runs, attention while
 * it waits for the user, error once it fails, meta once denied or cancelled by a stop, success
 * once done.
 * @internal
 */
export type ToolCallStatusKind = 'busy' | 'attention' | 'error' | 'denied' | 'success';

/** @internal */
export function getToolCallStatusKind(
    part: ChatToolCallPart,
    spec: ChatToolSpec
): ToolCallStatusKind {
    if (part.cancelled) return 'denied';
    switch (part.state) {
        case 'output-available':
            return 'success';
        case 'output-error':
            return 'error';
        case 'output-denied':
            return 'denied';
        case 'approval-requested':
            return 'attention';
        default:
            return isAwaitingAnswer(part, spec) ? 'attention' : 'busy';
    }
}

/**
 * The status glyph that leads a call's row: the chat spinner while it runs, else one icon per
 * state.
 * @internal
 */
export function statusGlyph(part: ChatToolCallPart, spec: ChatToolSpec): ReactNode {
    const kind = getToolCallStatusKind(part, spec);
    return span({
        className: `xh-chat-tool-call__glyph xh-chat-tool-call__glyph--${kind}`,
        item:
            kind === 'busy'
                ? chatSpinner()
                : part.cancelled
                  ? Icon.stopCircle({title: 'Cancelled'})
                  : GLYPHS[kind]()
    });
}

/**
 * Words for a call's status, or null once it succeeds - the check says it.
 * @internal
 */
export function getToolCallStatusLabel(part: ChatToolCallPart, spec: ChatToolSpec): string {
    if (part.cancelled) return 'Cancelled';
    switch (getToolCallStatusKind(part, spec)) {
        case 'success':
            return null;
        case 'error':
            return 'Failed';
        case 'denied':
            return 'Denied';
        case 'attention':
            return part.state === 'approval-requested' ? 'Needs approval' : 'Waiting for you';
        default:
            // A call the backend runs - one it marked so, or one with no `execute` here - runs
            // from the moment it is made. One a paused run left open waits with the run.
            if (
                part.state === 'input-available' &&
                !part.awaitsResume &&
                (part.providerExecuted || !spec?.execute)
            ) {
                return 'Running';
            }
            return PROGRESS_LABELS[part.state] ?? 'Running';
    }
}

/**
 * The first line of a failed call's error, to show in its row.
 * @internal
 */
export function getErrorLine(part: ChatToolCallPart): string {
    if (part.state !== 'output-error' || part.cancelled) return null;
    return (part.errorText ?? '').trim().split('\n')[0] || null;
}

/**
 * Status of a call shown inline - see {@link getInlineStatus}.
 * @internal
 */
export interface InlineCallStatus {
    type: 'rendering' | 'approval' | 'error' | 'denied';
    label: string;
}

/**
 * Status to show under a call with `display: 'inline'`, or null for none. The rendered output is
 * the progress of an inline call, so it shows a status only while its input streams, while it
 * waits for approval, and once it fails or is denied - never "Pending" or "Running" under a
 * component that has already rendered. An error shows a short message for the user, as the error
 * text is written for the model.
 * @internal
 */
export function getInlineStatus(part: ChatToolCallPart, spec: ChatToolSpec): InlineCallStatus {
    if (part.cancelled) return {type: 'denied', label: 'Stopped - not shown.'};
    switch (part.state) {
        case 'input-streaming':
            return {type: 'rendering', label: 'Rendering…'};
        case 'approval-requested':
            return {type: 'approval', label: 'Needs approval'};
        case 'output-error':
            return {
                type: 'error',
                label: `Could not show the ${getToolTitle(part, spec).toLowerCase()}.`
            };
        case 'output-denied':
            return {type: 'denied', label: 'Denied - not shown.'};
        default:
            return null;
    }
}

//------------------
// Implementation
//------------------
const GLYPHS: Record<Exclude<ToolCallStatusKind, 'busy'>, () => ReactElement> = {
    success: () => Icon.check({title: 'Done'}),
    error: () => Icon.error({title: 'Failed'}),
    denied: () => Icon.slashedCircle({title: 'Denied'}),
    attention: () => Icon.hand({title: 'Waiting for you'})
};

const PROGRESS_LABELS: Partial<Record<ChatToolCallState, string>> = {
    'input-streaming': 'Preparing',
    'input-available': 'Pending',
    running: 'Running'
};
