import {last} from 'lodash';
import type {ChatFilePart, ChatMessageListHost, ChatPart, ChatToolCallPart} from '../../../../core';
import {isAwaitingAnswer} from './ToolCallStatus';

/**
 * Consecutive files of a message, shown together as one row of chips.
 * @internal
 */
export interface ChatFileGroup {
    type: 'fileGroup';
    id: string;
    parts: ChatFilePart[];
}

/**
 * Consecutive tool calls of one step, shown together as one quiet row.
 * @internal
 */
export interface ChatToolCallGroupSpec {
    type: 'toolCallGroup';
    id: string;
    parts: ChatToolCallPart[];
}

/** @internal */
export type ChatPartGroup = ChatPart | ChatFileGroup | ChatToolCallGroupSpec;

/**
 * Consecutive process groups of a message - reasoning and tool call rows - shown as one block at
 * the tighter process gap, so that the steps of a reply read as one unit.
 * @internal
 */
export interface ChatProcessRun {
    type: 'process';
    id: string;
    groups: ChatPartGroup[];
}

/** The part of the host that grouping reads. @internal */
export type ChatGroupingHost = Pick<ChatMessageListHost, 'getToolSpec'>;

/**
 * Group the parts of an assistant message for display, in order. Sources are left out, as they
 * show after the body. So is reasoning with no text to show, which the header reports instead.
 *
 *  - Consecutive files form one group.
 *  - Two or more consecutive tool calls of the same step, each shown as a row, form one group.
 *    A call that waits for the user - for approval or for an answer - and a call shown inline
 *    are never grouped, so that they stay in view.
 *
 * @internal
 */
export function groupParts(parts: ChatPart[], host: ChatGroupingHost): ChatPartGroup[] {
    const ret: ChatPartGroup[] = [];
    parts.forEach(part => {
        if (part.type === 'source') return;
        if (part.type === 'reasoning' && !part.text?.trim()) return;

        const prev = last(ret);
        if (part.type === 'file') {
            if (prev?.type === 'fileGroup') {
                prev.parts.push(part);
            } else {
                ret.push({type: 'fileGroup', id: `files-${part.id}`, parts: [part]});
            }
            return;
        }

        if (part.type === 'toolCall' && isGroupable(part, host)) {
            if (prev?.type === 'toolCallGroup' && prev.parts[0].step === part.step) {
                prev.parts.push(part);
                return;
            }
            if (prev?.type === 'toolCall' && prev.step === part.step && isGroupable(prev, host)) {
                ret[ret.length - 1] = {
                    type: 'toolCallGroup',
                    id: `tools-${prev.id}`,
                    parts: [prev, part]
                };
                return;
            }
        }

        ret.push(part);
    });
    return ret;
}

/**
 * Gather consecutive process groups - reasoning, tool calls shown as rows, and groups of them -
 * into runs. A run ends at any output part, such as text, so text between two steps starts a new
 * run. A call with `display: 'inline'` is output, not process.
 * @internal
 */
export function groupProcessRuns(
    groups: ChatPartGroup[],
    host: ChatGroupingHost
): Array<ChatPartGroup | ChatProcessRun> {
    const ret: Array<ChatPartGroup | ChatProcessRun> = [];
    groups.forEach(group => {
        if (!isProcessGroup(group, host)) {
            ret.push(group);
            return;
        }
        const prev = last(ret);
        if (prev?.type === 'process') {
            prev.groups.push(group);
        } else {
            ret.push({type: 'process', id: `process-${group.id}`, groups: [group]});
        }
    });
    return ret;
}

//------------------
// Implementation
//------------------
function isGroupable(call: ChatToolCallPart, host: ChatGroupingHost): boolean {
    const spec = host.getToolSpec?.(call.toolName);
    return (
        spec?.display !== 'inline' &&
        call.state !== 'approval-requested' &&
        !isAwaitingAnswer(call, spec)
    );
}

function isProcessGroup(group: ChatPartGroup, host: ChatGroupingHost): boolean {
    switch (group.type) {
        case 'reasoning':
        case 'toolCallGroup':
            return true;
        case 'toolCall':
            return host.getToolSpec?.(group.toolName)?.display !== 'inline';
        default:
            return false;
    }
}
