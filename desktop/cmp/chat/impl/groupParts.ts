import {last} from 'lodash';
import {
    type ChatFilePart,
    type ChatPart,
    type ChatToolCallPart,
    type ChatToolDisplay,
    type ChatToolSpec,
    type ChatTranscript,
    isChatModel,
    isChatSubagentPart
} from '../../../../core';
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

/**
 * The parts of a reply shown as one activity timeline block - see `ChatTimeline`.
 * @internal
 */
export interface ChatTimelineGroup {
    type: 'timeline';

    /** From the first timeline call or sub-agent, so it holds as narration folds in ahead of it. */
    id: string;

    /** Timeline calls, sub-agents, and the narration and reasoning between them, in order. */
    parts: ChatPart[];

    /** Calls to `pinned` tools anywhere in the reply, in order - the latest is the plan. */
    pinned: ChatToolCallPart[];
}

/** @internal */
export type ChatPartGroup = ChatPart | ChatFileGroup | ChatToolCallGroupSpec | ChatTimelineGroup;

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

/**
 * The spec of a tool, for how its calls display: the chat's own, or for a plain transcript the
 * display-only tools of its catalog, so that its generative UI calls render as their components.
 * Null if the host has none, or if there is no host.
 * @internal
 */
export function getHostToolSpec(host: ChatTranscript, name: string): ChatToolSpec {
    if (isChatModel(host)) return host.getToolSpec(name);
    return host?.catalog?.displayTools.find(it => it.name === name) ?? null;
}

/**
 * How a call displays, from its tool's spec - see `ChatToolDisplay`. A call a sub-agent made
 * defaults to `timeline`, where it nests under the sub-agent. A hidden call shows as a card while
 * it waits for the user, so that a turn never waits on a call no one can see.
 * @internal
 */
export function getToolCallDisplay(call: ChatToolCallPart, host: ChatTranscript): ChatToolDisplay {
    const spec = getHostToolSpec(host, call.toolName),
        display = spec?.display ?? (call.subagentRunId != null ? 'timeline' : 'card');
    if (display === 'hidden' && isWaitingForUser(call, host)) return 'card';
    return display;
}

/**
 * Group the parts of an assistant message for display, in order. Sources are left out, as they
 * show after the body. So is reasoning with no text to show, which the header reports instead,
 * and so are calls to `hidden` tools.
 *
 *  - Calls to `timeline` tools, with sub-agents, form one activity timeline block. Text and
 *    reasoning between two such calls fold into the block as narration. Text after the last call
 *    stays below the block, as the answer, until another timeline call starts. Calls to `pinned`
 *    tools join the reply's first block, as its plan, or show as cards in a reply with none.
 *  - Consecutive files form one group.
 *  - Two or more consecutive `card` calls of the same step, each shown as a row, form one group.
 *    A call that waits for the user - for approval or for an answer - is never grouped, so that
 *    it stays in view.
 *
 * @internal
 */
export function groupParts(parts: ChatPart[], host: ChatTranscript): ChatPartGroup[] {
    const shown = parts.filter(part => isShown(part, host)),
        roles = shown.map(part => getRole(part, host)),
        hasTimeline = roles.includes('timeline'),
        ret: ChatPartGroup[] = [];

    let timeline: ChatTimelineGroup = null,
        firstTimeline: ChatTimelineGroup = null;
    shown.forEach((part, idx) => {
        const role = roles[idx];
        if (role === 'pinned' && hasTimeline) return;

        if (role === 'timeline' || (role === 'fold' && foldsIntoTimeline(roles, idx))) {
            if (!timeline) {
                timeline = {type: 'timeline', id: null, parts: [], pinned: []};
                firstTimeline ??= timeline;
                ret.push(timeline);
            }
            timeline.parts.push(part);
            timeline.id ??= role === 'timeline' ? `timeline-${part.id}` : null;
            return;
        }

        // A pinned call is transparent to a block - only output ends one.
        if (role !== 'pinned') timeline = null;
        addPart(ret, part, host);
    });

    if (firstTimeline) {
        firstTimeline.pinned = shown.filter(
            (part, idx) => roles[idx] === 'pinned'
        ) as ChatToolCallPart[];
    }
    return ret;
}

/**
 * Gather consecutive process groups - reasoning, tool calls shown as rows, and groups of them -
 * into runs. A run ends at any output part, such as text, so text between two steps starts a new
 * run. A call with `display: 'inline'` or `'answer'` is output, not process, and a timeline block
 * stands on its own.
 * @internal
 */
export function groupProcessRuns(
    groups: ChatPartGroup[],
    host: ChatTranscript
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
/** What a part is to the timeline: a member, text that may fold in, a plan, or other content. */
type PartRole = 'timeline' | 'fold' | 'pinned' | 'other';

function getRole(part: ChatPart, host: ChatTranscript): PartRole {
    switch (part.type) {
        case 'toolCall': {
            const display = getToolCallDisplay(part, host);
            if (display === 'timeline') return 'timeline';
            return display === 'pinned' ? 'pinned' : 'other';
        }
        case 'data':
            return isChatSubagentPart(part) ? 'timeline' : 'other';
        case 'text':
        case 'reasoning':
            return 'fold';
        default:
            return 'other';
    }
}

/** True if the next part that is not text, reasoning or a plan is a timeline member. */
function foldsIntoTimeline(roles: PartRole[], idx: number): boolean {
    for (let i = idx + 1; i < roles.length; i++) {
        if (roles[i] === 'fold' || roles[i] === 'pinned') continue;
        return roles[i] === 'timeline';
    }
    return false;
}

function isShown(part: ChatPart, host: ChatTranscript): boolean {
    switch (part.type) {
        case 'source':
            return false;
        case 'reasoning':
            return !!part.text?.trim();
        case 'toolCall':
            return getToolCallDisplay(part, host) !== 'hidden';
        default:
            return true;
    }
}

function addPart(ret: ChatPartGroup[], part: ChatPart, host: ChatTranscript) {
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
}

function isWaitingForUser(call: ChatToolCallPart, host: ChatTranscript): boolean {
    return (
        call.state === 'approval-requested' ||
        isAwaitingAnswer(call, getHostToolSpec(host, call.toolName))
    );
}

/** True for a call shown as a card row - a pinned call outside a timeline shows as one. */
function isCardRow(call: ChatToolCallPart, host: ChatTranscript): boolean {
    const display = getToolCallDisplay(call, host);
    return display === 'card' || display === 'pinned';
}

function isGroupable(call: ChatToolCallPart, host: ChatTranscript): boolean {
    return isCardRow(call, host) && !isWaitingForUser(call, host);
}

function isProcessGroup(group: ChatPartGroup, host: ChatTranscript): boolean {
    switch (group.type) {
        case 'reasoning':
        case 'toolCallGroup':
            return true;
        case 'toolCall':
            return isCardRow(group, host);
        default:
            return false;
    }
}
