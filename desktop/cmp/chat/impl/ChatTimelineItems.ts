import {isEqual, isNil, isPlainObject, isString, last, maxBy, minBy} from 'lodash';
import {
    type ChatDataPart,
    type ChatMessage,
    type ChatPart,
    type ChatReasoningPart,
    type ChatSubagentData,
    type ChatTextPart,
    type ChatToolCallPart,
    type ChatToolSpec,
    type ChatTranscript,
    isChatSubagentPart,
    isToolCallCancelled,
    isToolCallFailed,
    isToolCallFinal
} from '../../../../core';
import {getHostToolSpec} from './groupParts';
import {isAwaitingAnswer} from './ToolCallStatus';

/**
 * One row of an activity timeline, with any rows nested under it.
 * @internal
 */
export type ChatTimelineItem =
    | ChatTimelineCallItem
    | ChatTimelineBatchItem
    | ChatTimelineNarrationItem
    | ChatTimelineReasoningItem
    | ChatTimelineAgentItem;

/** @internal */
export interface ChatTimelineCallItem {
    type: 'call';
    id: string;
    part: ChatToolCallPart;

    /** Which retry of an earlier failed call with the same tool and input this is, or 0. */
    retry: number;
}

/** Three or more consecutive calls of one tool, with nothing between them. @internal */
export interface ChatTimelineBatchItem {
    type: 'batch';
    id: string;
    items: ChatTimelineCallItem[];
}

/** @internal */
export interface ChatTimelineNarrationItem {
    type: 'narration';
    id: string;
    part: ChatTextPart;
}

/** @internal */
export interface ChatTimelineReasoningItem {
    type: 'reasoning';
    id: string;
    part: ChatReasoningPart;
}

/** @internal */
export interface ChatTimelineAgentItem {
    type: 'agent';
    id: string;
    part: ChatDataPart;
    data: ChatSubagentData;
    items: ChatTimelineItem[];
}

/** Calls of one tool in a row that merge into a batch. @internal */
export const TIMELINE_BATCH_MIN = 3;

/**
 * The rows of a timeline, from the parts of its block. Calls and sub-agents nest under the
 * sub-agent that made them. Three or more consecutive calls of one tool, with no narration
 * between, merge into a batch. A call that waits for the user never joins a batch.
 * @internal
 */
export function buildTimelineItems(parts: ChatPart[], host: ChatTranscript): ChatTimelineItem[] {
    const agentIds = new Set(parts.filter(isChatSubagentPart).map(it => it.id)),
        retries = getRetries(parts),
        scopeOf = (part: ChatPart): string => {
            if (part.type === 'toolCall') {
                return agentIds.has(part.subagentRunId) ? part.subagentRunId : null;
            }
            if (isChatSubagentPart(part)) {
                const parentId = (part.data as ChatSubagentData)?.parentSubagentRunId;
                return agentIds.has(parentId) && parentId !== part.id ? parentId : null;
            }
            return null;
        },
        build = (scope: string, seen: Set<string>): ChatTimelineItem[] => {
            const items: ChatTimelineItem[] = [];
            parts.forEach(part => {
                if (scopeOf(part) !== scope) return;
                switch (part.type) {
                    case 'toolCall':
                        items.push({
                            type: 'call',
                            id: part.id,
                            part,
                            retry: retries.get(part.id) ?? 0
                        });
                        return;
                    case 'text':
                        if (part.text.trim()) {
                            items.push({type: 'narration', id: part.id, part});
                        }
                        return;
                    case 'reasoning':
                        items.push({type: 'reasoning', id: part.id, part});
                        return;
                    case 'data': {
                        // Guard a cycle of parents, which would nest forever.
                        if (!isChatSubagentPart(part) || seen.has(part.id)) return;
                        const nextSeen = new Set(seen).add(part.id);
                        items.push({
                            type: 'agent',
                            id: part.id,
                            part,
                            data: part.data,
                            items: build(part.id, nextSeen)
                        });
                    }
                }
            });
            return batchCalls(items, host);
        };
    return build(null, new Set());
}

/** Every call in a list of rows, at any depth, in order. @internal */
export function getTimelineCalls(items: ChatTimelineItem[]): ChatToolCallPart[] {
    return items.flatMap(item => {
        switch (item.type) {
            case 'call':
                return [item.part];
            case 'batch':
                return item.items.map(it => it.part);
            case 'agent':
                return getTimelineCalls(item.items);
            default:
                return [];
        }
    });
}

/** Every sub-agent in a list of rows, at any depth. @internal */
export function getTimelineAgents(items: ChatTimelineItem[]): ChatTimelineAgentItem[] {
    return items.flatMap(item =>
        item.type === 'agent' ? [item, ...getTimelineAgents(item.items)] : []
    );
}

/**
 * What a timeline's line sums up: its counts, what runs, and what waits for the user.
 * @internal
 */
export interface ChatTimelineSummary {
    /** Every call, at any depth, in order. */
    calls: ChatToolCallPart[];
    agentCount: number;

    /** Calls that failed - not those cancelled by a stop. */
    failedCount: number;

    /** Calls cancelled by a stop. */
    cancelledCount: number;

    /** True if every failed call was retried with success. */
    isAllRetried: boolean;

    /** Calls in progress, newest last - not those that wait for the user. */
    running: ChatToolCallPart[];

    /** Sub-agents still running, newest last. */
    runningAgents: ChatSubagentData[];

    /** The first call waiting for approval, or null. */
    approval: ChatToolCallPart;

    /** Every call waiting for approval, in order. */
    approvals: ChatToolCallPart[];

    /** The first call waiting for the user's answer, or null. */
    question: ChatToolCallPart;

    /** The latest finished sentence of narration, if narration is the newest row, or null. */
    narration: string;

    /** True if reasoning is the newest row and still streams. */
    isThinking: boolean;
}

/** @internal */
export function summarizeTimeline(
    items: ChatTimelineItem[],
    host: ChatTranscript
): ChatTimelineSummary {
    const calls = getTimelineCalls(items),
        specOf = (call: ChatToolCallPart) => getHostToolSpec(host, call.toolName),
        failed = calls.filter(isToolCallFailed),
        newest = last(items);

    return {
        calls,
        agentCount: getTimelineAgents(items).length,
        failedCount: failed.length,
        cancelledCount: calls.filter(isToolCallCancelled).length,
        isAllRetried: failed.length > 0 && failed.every(it => isRetriedWithSuccess(it, calls)),
        running: calls.filter(
            it =>
                !isToolCallFinal(it) &&
                it.state !== 'approval-requested' &&
                !isAwaitingAnswer(it, specOf(it))
        ),
        runningAgents: getTimelineAgents(items)
            .map(it => it.data)
            .filter(it => it?.status === 'running'),
        approval: calls.find(it => it.state === 'approval-requested') ?? null,
        approvals: calls.filter(it => it.state === 'approval-requested'),
        question: calls.find(it => isAwaitingAnswer(it, specOf(it))) ?? null,
        narration: newest?.type === 'narration' ? lastSentence(newest.part) : null,
        isThinking: newest?.type === 'reasoning' && newest.part.state === 'streaming'
    };
}

/**
 * The state of a timeline's line - see the P2 block state matrix.
 *
 *  - `running` - calls or sub-agents run, or the agent works between them.
 *  - `quiet` - running, with no data for longer than the chat's stall time.
 *  - `approval`, `question` - a call waits for the user.
 *  - `paused` - the reply waits on the user for something outside the block.
 *  - `done` - the work is done, though the reply may still be writing its answer.
 *  - `stopped` - the user stopped the reply.
 *  - `failed` - the reply failed.
 * @internal
 */
export type ChatTimelineState =
    'running' | 'quiet' | 'approval' | 'question' | 'paused' | 'done' | 'stopped' | 'failed';

/** @internal */
export function getTimelineState({
    message,
    summary,
    isFollowed,
    isQuiet
}: {
    message: ChatMessage;
    summary: ChatTimelineSummary;

    /** True if more of the reply follows the block - its answer has started. */
    isFollowed: boolean;

    /** True if the chat has had no data for longer than its stall time. */
    isQuiet: boolean;
}): ChatTimelineState {
    switch (message.status) {
        case 'aborted':
            return 'stopped';
        case 'error':
            return 'failed';
    }
    if (summary.approval) return 'approval';
    if (summary.question) return 'question';
    if (message.status === 'paused') return 'paused';
    if (!message.isStreaming) return 'done';

    // The line swaps to its summary in place once the answer starts below it.
    const isWorking = summary.running.length > 0 || summary.runningAgents.length > 0;
    if (!isWorking && isFollowed) return 'done';
    return isQuiet ? 'quiet' : 'running';
}

//------------------
// Text
//------------------
/**
 * The input of a call as one line, for its row: the tool's own `summary`, else the first text
 * value of its input - a query's first line, a path, a search phrase - with runs of whitespace
 * collapsed. Code-like values set `isCode`, for a monospace font.
 * @internal
 */
export function summarizeInput(
    part: ChatToolCallPart,
    spec: ChatToolSpec
): {text: string; isCode: boolean} {
    const own = spec?.summary?.(part);
    if (own) return {text: own, isCode: false};

    const input = part.input;
    if (!isPlainObject(input)) return {text: null, isCode: false};

    const key =
            SUMMARY_KEYS.find(it => isString(input[it]) && input[it].trim()) ??
            Object.keys(input).find(it => isString(input[it]) && input[it].trim()),
        value: string = key ? input[key] : null;
    if (!value) return {text: null, isCode: false};

    const firstLine = value.trim().split('\n')[0];
    return {text: firstLine.replace(/\s+/g, ' ').trim(), isCode: CODE_KEYS.includes(key)};
}

/**
 * A step's duration as a short label: "<0.1s" under 100 ms, tenths of a second under a minute,
 * then minutes and seconds.
 * @internal
 */
export function formatStepDuration(ms: number): string {
    if (ms == null || ms < 0) return null;
    if (ms < 100) return '<0.1s';
    const secs = ms / 1000;
    if (secs < 60) return `${secs.toFixed(1)}s`;
    const mins = Math.floor(secs / 60);
    return `${mins}m ${String(Math.round(secs - mins * 60)).padStart(2, '0')}s`;
}

/** The time a set of calls spans, from the first start to the last end, or null. @internal */
export function getSpanMs(calls: ChatToolCallPart[]): number {
    const start = minBy(calls, 'startedAt')?.startedAt,
        end = maxBy(calls, 'endedAt')?.endedAt;
    if (isNil(start) || isNil(end) || calls.some(it => it.endedAt == null)) return null;
    return end - start;
}

//------------------
// Implementation
//------------------
const SUMMARY_KEYS = [
    'query',
    'sql',
    'q',
    'search',
    'path',
    'file',
    'filePath',
    'url',
    'command',
    'city',
    'name',
    'title'
];
const CODE_KEYS = ['query', 'sql', 'path', 'file', 'filePath', 'url', 'command', 'code'];

// Retries: a later call with the same tool, input and sub-agent as an earlier failed one.
function getRetries(parts: ChatPart[]): Map<string, number> {
    const ret = new Map<string, number>(),
        calls = parts.filter(it => it.type === 'toolCall') as ChatToolCallPart[];
    calls.forEach((call, idx) => {
        const failedBefore = calls
            .slice(0, idx)
            .filter(it => isToolCallFailed(it) && isSameCall(it, call)).length;
        if (failedBefore) ret.set(call.id, failedBefore);
    });
    return ret;
}

function isRetriedWithSuccess(failed: ChatToolCallPart, calls: ChatToolCallPart[]): boolean {
    const idx = calls.indexOf(failed);
    return calls
        .slice(idx + 1)
        .some(it => it.state === 'output-available' && isSameCall(it, failed));
}

function isSameCall(a: ChatToolCallPart, b: ChatToolCallPart): boolean {
    return (
        a.toolName === b.toolName &&
        (a.subagentRunId ?? null) === (b.subagentRunId ?? null) &&
        isEqual(a.input, b.input)
    );
}

function batchCalls(items: ChatTimelineItem[], host: ChatTranscript): ChatTimelineItem[] {
    const ret: ChatTimelineItem[] = [];
    let run: ChatTimelineCallItem[] = [];
    const flush = () => {
        if (run.length >= TIMELINE_BATCH_MIN) {
            ret.push({type: 'batch', id: `batch-${run[0].id}`, items: run});
        } else {
            ret.push(...run);
        }
        run = [];
    };

    items.forEach(item => {
        const canBatch =
            item.type === 'call' &&
            item.part.state !== 'approval-requested' &&
            !isAwaitingAnswer(item.part, getHostToolSpec(host, item.part.toolName));
        if (canBatch && run.length && run[0].part.toolName !== item.part.toolName) flush();
        if (canBatch) {
            run.push(item);
        } else {
            flush();
            ret.push(item);
        }
    });
    flush();
    return ret;
}

/** The last finished sentence of narration - never one still being written. */
function lastSentence(part: ChatTextPart): string {
    const isDone = part.state === 'done',
        text = part.text.replace(/\s+/g, ' ').trimStart(),
        // While the text streams, a sentence ends only once a space follows it - "3." may be "3.5".
        sentences = text.match(isDone ? /[^.!?]+[.!?]+(?=\s|$)/g : /[^.!?]+[.!?]+(?=\s)/g);
    if (sentences) return last(sentences).trim();
    return isDone ? text.trim() || null : null;
}
