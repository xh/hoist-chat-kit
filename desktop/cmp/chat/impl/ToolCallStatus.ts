import type {ReactElement, ReactNode} from 'react';
import {span} from '@xh/hoist/cmp/layout';
import {Icon} from '@xh/hoist/icon';
import type {ChatToolCallPart, ChatToolCallState, ChatToolSpec} from '../../../../core';
import {humanizeToolName} from './ChatFormat';
import {classNames} from '../../../../impl/ClassNames';

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
 * Status of a call, as an icon and a label, or a check alone once it succeeds.
 * @internal
 */
export function statusIndicator(part: ChatToolCallPart, spec: ChatToolSpec): ReactNode {
    const {state} = part;
    if (state === 'output-available') {
        return Icon.check({className: 'xh-chat-tool-call__status-icon', title: 'Done'});
    }

    const isWaiting = state === 'approval-requested' || isAwaitingAnswer(part, spec);
    let icon: ReactElement, label: string;
    if (isWaiting) {
        icon = Icon.hand();
        label = state === 'approval-requested' ? 'Needs approval' : 'Waiting for you';
    } else if (state === 'output-error') {
        icon = Icon.warningCircle();
        label = 'Failed';
    } else if (state === 'output-denied') {
        icon = Icon.slashedCircle();
        label = 'Denied';
    } else {
        icon = Icon.spinnerThird({spin: true});
        label = PROGRESS_LABELS[state] ?? 'Running';
    }

    return span({
        className: classNames('xh-chat-tool-call__status-label', {
            'xh-chat-tool-call__status-label--waiting': isWaiting
        }),
        items: [icon, label]
    });
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
const PROGRESS_LABELS: Partial<Record<ChatToolCallState, string>> = {
    'input-streaming': 'Preparing',
    'input-available': 'Pending',
    running: 'Running'
};
