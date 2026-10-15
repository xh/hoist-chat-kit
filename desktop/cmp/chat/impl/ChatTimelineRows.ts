import {compact, isEmpty, isFunction, isString, uniq} from 'lodash';
import type {CSSProperties, ReactNode} from 'react';
import {div, li, span, ul} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, uses} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {pluralize} from '@xh/hoist/utils/js';
import {chatMarkdown} from '../../../../cmp/markdown';
import {
    type ChatTranscript,
    type ChatPartRenderContext,
    type ChatToolCallPart,
    type ChatToolSpec
} from '../../../../core';
import {classNames} from '../../../../impl/ClassNames';
import {chatElapsed} from '../ChatElapsed';
import {chatCopyButton} from './ChatCopyButton';
import {chatSpinner} from '../../../impl/ChatLiveCues';
import {
    type ChatTimelineAgentItem,
    type ChatTimelineBatchItem,
    type ChatTimelineCallItem,
    type ChatTimelineItem,
    type ChatTimelinePlan,
    formatAnswer,
    formatStepDuration,
    getPlanPosition,
    getSpanMs,
    getTimelineCalls,
    summarizeInput
} from './ChatTimelineItems';
import type {ChatTimelineLocalModel} from './ChatTimelineLocalModel';
import {getHostToolSpec} from './groupParts';
import {CHAT_MARKDOWN_COMPONENTS} from './MarkdownComponents';
import {getErrorLine, getToolTitle, isAwaitingAnswer} from './ToolCallStatus';

/** Levels of nesting shown as indent. Deeper rows name their parent instead. @internal */
export const TIMELINE_MAX_DEPTH = 3;

/** Lines a details pane shows before it offers the rest in full. @internal */
export const TIMELINE_PANE_MAX_LINES = 500;

/** What every row of one timeline reads. @internal */
export interface ChatTimelineRowContext {
    impl: ChatTimelineLocalModel;

    /** The conversation, for the specs of its tools. */
    host: ChatTranscript;
    context: ChatPartRenderContext;

    /** True once the reply was stopped - calls still in flight show as cancelled. */
    isStopped: boolean;

    /** True while the reply streams. A sub-agent shows as running only then. */
    isLive: boolean;

    /** Id of the row that holds the tree's one tab stop. */
    tabStopId: string;
}

/**
 * The rows of a timeline, as tree items, nested to `depth`.
 * @internal
 */
export function timelineRows(
    items: ChatTimelineItem[],
    ctx: ChatTimelineRowContext,
    depth: number = 0,
    parentName: string = null
): ReactNode[] {
    return items.map(item => {
        switch (item.type) {
            case 'call':
                return callRow(item, ctx, depth, parentName);
            case 'batch':
                return batchRow(item, ctx, depth, parentName);
            case 'agent':
                return agentRow(item, ctx, depth, parentName);
            case 'narration':
                return treeItem({
                    id: item.id,
                    depth,
                    ctx,
                    className: 'xh-chat-timeline__leaf',
                    items: [
                        div({
                            key: 'text',
                            className: 'xh-chat-timeline__narration',
                            item: chatMarkdown({
                                content: item.part.text,
                                isStreaming: item.part.state === 'streaming',
                                components: CHAT_MARKDOWN_COMPONENTS
                            })
                        })
                    ]
                });
            case 'reasoning':
                return reasoningRow(item.part.id, item, ctx, depth);
        }
    });
}

/**
 * The pinned plan: a labeled list of items, each done, active, pending or skipped. A plan that is
 * not a list renders with its tool's renderer, or as JSON.
 * @internal
 */
export function timelinePlan(plan: ChatTimelinePlan, ctx: ChatTimelineRowContext): ReactNode {
    const {items, call, spec} = plan;
    if (!items) {
        return div({
            className: 'xh-chat-timeline__plan',
            items: [
                div({className: 'xh-chat-timeline__plan-head', item: 'Plan'}),
                spec?.renderer
                    ? timelineRenderer({part: call, spec, context: ctx.context})
                    : paneBody(call.output ?? call.input)
            ]
        });
    }

    const position = getPlanPosition(items);
    return div({
        className: 'xh-chat-timeline__plan',
        items: [
            div({
                className: 'xh-chat-timeline__plan-head',
                'aria-hidden': true,
                item: `Plan · ${position} of ${items.length}`
            }),
            ul({
                className: 'xh-chat-timeline__plan-list',
                'aria-label': `Plan, ${position} of ${items.length}`,
                items: items.map((it, idx) =>
                    li({
                        key: idx,
                        className: `xh-chat-timeline__plan-item xh-chat-timeline__plan-item--${it.status}`,
                        items: [
                            span({
                                className: 'xh-chat-timeline__icon',
                                item: PLAN_ICONS[it.status]()
                            }),
                            span({
                                className: 'xh-chat-timeline__plan-title',
                                item: it.status === 'skipped' ? `${it.title} · skipped` : it.title
                            })
                        ]
                    })
                )
            })
        ]
    });
}

//------------------
// Rows
//------------------
/** The state a call's row shows. */
type RowState =
    'running' | 'approval' | 'question' | 'done' | 'answered' | 'failed' | 'denied' | 'cancelled';

function getRowState(part: ChatToolCallPart, spec: ChatToolSpec, isStopped: boolean): RowState {
    if (part.cancelled) return 'cancelled';
    switch (part.state) {
        case 'output-available':
            return spec?.interactive && !spec.execute ? 'answered' : 'done';
        case 'output-error':
            return 'failed';
        case 'output-denied':
            return 'denied';
        case 'approval-requested':
            return isStopped ? 'cancelled' : 'approval';
        default:
            if (isStopped) return 'cancelled';
            return isAwaitingAnswer(part, spec) ? 'question' : 'running';
    }
}

function callRow(
    item: ChatTimelineCallItem,
    ctx: ChatTimelineRowContext,
    depth: number,
    parentName: string
): ReactNode {
    const {part, retry} = item,
        {impl, host, isStopped} = ctx,
        spec = getHostToolSpec(host, part.toolName),
        state = getRowState(part, spec, isStopped),
        title = getToolTitle(part, spec),
        input = summarizeInput(part, spec),
        hasDetails = state !== 'answered' && hasCallDetails(part, spec),
        isOpen = hasDetails && impl.isRowOpen(part.id),
        isApproved = state === 'done' && needsApproval(spec, part),
        deniedReason = state === 'denied' ? getDeniedReason(part) : null,
        took = getCallMs(part),
        status = getStatusWords(part, state, spec),
        answer = state === 'answered' ? formatAnswer(part.output) : null;

    return treeItem({
        id: part.id,
        depth,
        ctx,
        isOpen: hasDetails ? isOpen : null,
        className: classNames(`xh-chat-timeline__item--${state}`),
        label: compact([
            title,
            state === 'answered' || state === 'question' ? null : input.text,
            rowStateLabel(state, {status, retry, took, deniedReason, answer, isApproved})
        ]).join(', '),
        items: [
            rowLine({
                ctx,
                id: part.id,
                depth,
                isOpen,
                hasDetails,
                icon: callIcon(state, spec),
                title: depthTitle(title, depth, parentName),
                input:
                    state === 'answered'
                        ? [
                              'You chose ',
                              span({key: 'a', className: 'xh-chat-timeline__chosen', item: answer})
                          ]
                        : status
                          ? null
                          : compact([retry ? `retry ${retry} · ` : null, input.text]).join('') ||
                            (state === 'running' ? 'running' : null),
                isCode: input.isCode && !status && state !== 'answered',
                status,
                tag: isApproved ? 'Approved' : null,
                time: callTime(part, state)
            }),
            deniedReason
                ? div({
                      key: 'reason',
                      className: 'xh-chat-timeline__reason',
                      item: `You: “${deniedReason}”`
                  })
                : null,
            isOpen ? timelineDetails({key: 'details', part, spec, context: ctx.context}) : null
        ]
    });
}

function batchRow(
    item: ChatTimelineBatchItem,
    ctx: ChatTimelineRowContext,
    depth: number,
    parentName: string
): ReactNode {
    const {impl, host, isStopped} = ctx,
        calls = item.items.map(it => it.part),
        first = calls[0],
        spec = getHostToolSpec(host, first.toolName),
        title = getToolTitle(first, spec),
        states = calls.map(it => getRowState(it, spec, isStopped)),
        failed = states.filter(it => it === 'failed').length,
        isRunning = states.includes('running'),
        isOpen = impl.isRowOpen(item.id),
        targets = uniq(compact(calls.map(it => summarizeInput(it, spec).text))),
        shown = targets.slice(0, 4),
        input = shown.length
            ? shown.join(', ') + (targets.length > 4 ? `, +${targets.length - 4}` : '')
            : null,
        spanMs = getSpanMs(calls);

    return treeItem({
        id: item.id,
        depth,
        ctx,
        isOpen,
        className: classNames('xh-chat-timeline__item--batch', {
            'xh-chat-timeline__item--failed': failed > 0
        }),
        label: compact([
            title,
            `${calls.length} calls`,
            failed ? `${failed} failed` : null,
            isRunning ? 'running' : null
        ]).join(', '),
        items: [
            rowLine({
                ctx,
                id: item.id,
                depth,
                isOpen,
                hasDetails: true,
                icon: isRunning
                    ? callIcon('running', spec)
                    : failed
                      ? callIcon('failed', spec)
                      : callIcon('done', spec),
                title: depthTitle(title, depth, parentName),
                count: calls.length,
                input,
                time: isRunning
                    ? liveTime(first.startedAt)
                    : spanMs != null
                      ? formatStepDuration(spanMs)
                      : null
            }),
            isOpen ? group(timelineRows(item.items, ctx, depth + 1, title)) : null
        ]
    });
}

function agentRow(
    item: ChatTimelineAgentItem,
    ctx: ChatTimelineRowContext,
    depth: number,
    parentName: string
): ReactNode {
    const {impl, isLive} = ctx,
        {data} = item,
        name = data?.name ?? 'Agent',
        // A reply that is no longer live has nothing running, whatever its data says.
        isRunning = data?.status === 'running' && isLive,
        isFailed = data?.status === 'error',
        isCancelled = data?.status === 'cancelled',
        // Open while it runs, closed once done - until the user opens or closes it.
        isOpen = impl.isRowOpen(item.id, isRunning),
        steps = getTimelineCalls(item.items).length,
        result = data?.status === 'complete' ? formatResult(data.result) : null,
        took =
            data?.startedAt != null && data?.endedAt != null ? data.endedAt - data.startedAt : null;

    return treeItem({
        id: item.id,
        depth,
        ctx,
        isOpen,
        className: classNames('xh-chat-timeline__item--agent', {
            'xh-chat-timeline__item--failed': isFailed
        }),
        label: compact([
            name,
            data?.description,
            'agent',
            pluralize('step', steps, true),
            isRunning
                ? 'running'
                : isFailed
                  ? `failed: ${data.error}`
                  : isCancelled
                    ? 'cancelled'
                    : null
        ]).join(', '),
        items: [
            rowLine({
                ctx,
                id: item.id,
                depth,
                isOpen,
                hasDetails: true,
                icon: isRunning
                    ? span({className: 'xh-chat-timeline__icon--busy', item: chatSpinner()})
                    : isFailed
                      ? span({className: 'xh-chat-timeline__icon--error', item: Icon.xCircle()})
                      : isCancelled
                        ? Icon.stopCircle()
                        : Icon.sparkles(),
                title: depthTitle(name, depth, parentName),
                input: isOpen
                    ? data?.description
                    : compact([
                          data?.description,
                          steps ? pluralize('step', steps, true) : null
                      ]).join(' · '),
                status: isFailed ? data.error : isCancelled ? 'Cancelled' : null,
                time: isRunning
                    ? liveTime(data.startedAt)
                    : took != null
                      ? formatStepDuration(took)
                      : null
            }),
            isOpen
                ? group([
                      ...timelineRows(item.items, ctx, depth + 1, name),
                      result
                          ? treeItem({
                                key: `${item.id}-result`,
                                id: `${item.id}-result`,
                                depth: depth + 1,
                                ctx,
                                className: 'xh-chat-timeline__leaf',
                                items: [
                                    div({
                                        key: 'result',
                                        className: 'xh-chat-timeline__result',
                                        items: [
                                            span({
                                                key: 'label',
                                                className: 'xh-chat-timeline__result-label',
                                                item: 'Result:'
                                            }),
                                            ' ',
                                            result
                                        ]
                                    })
                                ]
                            })
                          : null
                  ])
                : null
        ]
    });
}

function reasoningRow(
    id: string,
    item: Extract<ChatTimelineItem, {type: 'reasoning'}>,
    ctx: ChatTimelineRowContext,
    depth: number
): ReactNode {
    const {part} = item,
        isThinking = part.state === 'streaming',
        isOpen = ctx.impl.isRowOpen(id),
        firstLine = part.text
            .trim()
            .split('\n')[0]
            .replace(/[*_#`>]/g, '')
            .trim(),
        title = isThinking ? 'Thinking' : 'Thought';

    return treeItem({
        id,
        depth,
        ctx,
        isOpen,
        className: 'xh-chat-timeline__item--reasoning',
        label: compact([title, firstLine]).join(', '),
        items: [
            rowLine({
                ctx,
                id,
                depth,
                isOpen,
                hasDetails: true,
                icon: isThinking
                    ? span({className: 'xh-chat-timeline__icon--busy', item: chatSpinner()})
                    : Icon.ai(),
                title,
                input: firstLine,
                time: isThinking
                    ? liveTime(part.startedAt)
                    : part.endedAt != null
                      ? formatStepDuration(part.endedAt - part.startedAt)
                      : null
            }),
            isOpen
                ? div({
                      key: 'details',
                      className: 'xh-chat-timeline__detail',
                      item: div({
                          className: 'xh-chat-timeline__narration',
                          item: chatMarkdown({
                              content: part.text,
                              isStreaming: isThinking,
                              components: CHAT_MARKDOWN_COMPONENTS
                          })
                      })
                  })
                : null
        ]
    });
}

interface TreeItemArgs {
    key?: string;
    id: string;
    depth: number;
    ctx: ChatTimelineRowContext;
    className?: string;

    /** True or false for a row that opens, null for one that does not. */
    isOpen?: boolean;

    /** Name for screen readers, as title, input, then state. Default its text. */
    label?: string;
    items: ReactNode[];
}

function treeItem({key, id, depth, ctx, className, isOpen = null, label, items}: TreeItemArgs) {
    return li({
        key: key ?? id,
        className: classNames('xh-chat-timeline__item', className),
        role: 'treeitem',
        // Read by the tree's keyboard handler.
        ...({'data-id': id} as PlainObject),
        'aria-level': depth + 1,
        'aria-expanded': isOpen == null ? undefined : isOpen,
        'aria-label': label,
        tabIndex: ctx.tabStopId === id ? 0 : -1,
        style: {'--xh-chat-timeline-depth': Math.min(depth, TIMELINE_MAX_DEPTH)} as CSSProperties,
        items
    });
}

interface RowLineArgs {
    ctx: ChatTimelineRowContext;
    id: string;
    depth: number;
    isOpen: boolean;
    hasDetails: boolean;
    icon: ReactNode;
    title: ReactNode;
    input?: ReactNode;
    isCode?: boolean;
    count?: number;
    status?: string;
    tag?: string;
    time?: ReactNode;
}

// The 24 px line of a row: icon, title, input or status words, count, time and chevron. A click
// opens a row that has details or children.
function rowLine(args: RowLineArgs): ReactNode {
    const {ctx, id, isOpen, hasDetails, icon, title, input, isCode, count, status, tag, time} =
        args;
    return div({
        key: 'line',
        className: classNames('xh-chat-timeline__row', {
            'xh-chat-timeline__row--open': isOpen,
            'xh-chat-timeline__row--static': !hasDetails
        }),
        onClick: () => {
            ctx.impl.setFocusId(id);
            if (hasDetails) ctx.impl.setRowOpen(id, !isOpen);
        },
        items: [
            span({className: 'xh-chat-timeline__icon', item: icon}),
            span({className: 'xh-chat-timeline__title', item: title}),
            count != null ? span({className: 'xh-chat-timeline__count', item: count}) : null,
            status
                ? span({className: 'xh-chat-timeline__status', title: status, item: status})
                : input
                  ? span({
                        className: classNames('xh-chat-timeline__input', {
                            'xh-chat-timeline__input--code': isCode
                        }),
                        title: isString(input) ? input : undefined,
                        item: input
                    })
                  : span({className: 'xh-chat-timeline__input'}),
            tag ? span({className: 'xh-chat-timeline__tag', item: tag}) : null,
            span({className: 'xh-chat-timeline__time', item: time ?? null}),
            span({
                className: 'xh-chat-timeline__chevron',
                item: hasDetails ? (isOpen ? Icon.chevronDown() : Icon.chevronRight()) : null
            })
        ]
    });
}

function group(items: ReactNode[]): ReactNode {
    return ul({key: 'group', className: 'xh-chat-timeline__group', role: 'group', items});
}

// Deeper than the indent goes, a row names its parent: "› Limits Checker  Read policy".
function depthTitle(title: string, depth: number, parentName: string): ReactNode {
    if (depth <= TIMELINE_MAX_DEPTH || !parentName) return title;
    return [
        span({key: 'p', className: 'xh-chat-timeline__parent', item: `› ${parentName} `}),
        title
    ];
}

function callIcon(state: RowState, spec: ChatToolSpec): ReactNode {
    switch (state) {
        case 'running':
            return span({className: 'xh-chat-timeline__icon--busy', item: chatSpinner()});
        case 'approval':
        case 'question':
            return span({className: 'xh-chat-timeline__icon--attention', item: Icon.pauseCircle()});
        case 'failed':
            return span({className: 'xh-chat-timeline__icon--error', item: Icon.xCircle()});
        case 'denied':
            return Icon.slashedCircle();
        case 'cancelled':
            return Icon.stopCircle();
        case 'answered':
            return Icon.comment();
        default:
            return spec?.icon ?? Icon.wrench();
    }
}

// Words that replace the input when a row fails, waits or ends without running.
function getStatusWords(part: ChatToolCallPart, state: RowState, spec: ChatToolSpec): string {
    switch (state) {
        case 'failed':
            return getErrorLine(part) ?? 'Failed';
        case 'approval':
            return 'Needs approval';
        case 'question':
            return getQuestionText(part, spec);
        case 'denied':
            return 'Denied';
        case 'cancelled':
            return 'Cancelled';
        default:
            return null;
    }
}

function getQuestionText(part: ChatToolCallPart, spec: ChatToolSpec): string {
    const input = part.input ?? {},
        question = [input.question, input.prompt, input.text].find(isString);
    return question?.trim() || getToolTitle(part, spec);
}

function rowStateLabel(
    state: RowState,
    {
        status,
        retry,
        took,
        deniedReason,
        answer,
        isApproved
    }: {
        status: string;
        retry: number;
        took: number;
        deniedReason: string;
        answer: string;
        isApproved: boolean;
    }
): string {
    const done = compact(['done', took != null ? describeDuration(took) : null]).join(', ');
    switch (state) {
        case 'running':
            return 'running';
        case 'approval':
            return 'needs approval';
        case 'question':
            return `question: ${status}`;
        case 'failed':
            return `failed: ${status}`;
        case 'denied':
            return deniedReason ? `denied by you: ${deniedReason}` : 'denied by you';
        case 'cancelled':
            return 'cancelled';
        case 'answered':
            return `you chose ${answer}`;
        default:
            return compact([
                retry ? `retry ${retry}` : null,
                isApproved ? 'approved' : null,
                done
            ]).join(', ');
    }
}

function describeDuration(ms: number): string {
    if (ms < 100) return 'under 0.1 seconds';
    const secs = Math.round(ms / 100) / 10;
    return `${secs} ${secs === 1 ? 'second' : 'seconds'}`;
}

function callTime(part: ChatToolCallPart, state: RowState): ReactNode {
    switch (state) {
        case 'running':
        case 'question':
        case 'approval':
            return liveTime(part.startedAt);
        case 'denied':
        case 'cancelled':
            return '—';
        default: {
            const took = getCallMs(part);
            return took != null ? formatStepDuration(took) : null;
        }
    }
}

function liveTime(startedAt: number): ReactNode {
    return startedAt != null ? chatElapsed({startedAt}) : null;
}

function getCallMs(part: ChatToolCallPart): number {
    const {startedAt, endedAt} = part;
    return startedAt != null && endedAt != null ? endedAt - startedAt : null;
}

function needsApproval(spec: ChatToolSpec, part: ChatToolCallPart): boolean {
    const {needsApproval} = spec ?? {};
    return isFunction(needsApproval) ? !!needsApproval(part.input ?? {}) : !!needsApproval;
}

// A denial's reason, unless it is the kit's own default text.
function getDeniedReason(part: ChatToolCallPart): string {
    const text = part.errorText?.trim();
    return text && text !== DEFAULT_DENIAL ? text : null;
}

function formatResult(result: unknown): string {
    if (result == null) return null;
    if (isString(result)) return result.trim() || null;
    return formatAnswer(result);
}

function hasCallDetails(part: ChatToolCallPart, spec: ChatToolSpec): boolean {
    return (
        !!spec?.renderer ||
        !isEmpty(part.input ?? part.inputText) ||
        part.state === 'output-error' ||
        (part.state === 'output-available' && part.output != null)
    );
}

//------------------
// Details
//------------------
interface TimelineDetailsProps extends HoistProps {
    part: ChatToolCallPart;
    spec: ChatToolSpec;
    context: ChatPartRenderContext;
}

/**
 * The details of an open call: its tool's own rendering, or else Input, Output and Error panes.
 * Mounted only while the row is open.
 */
const timelineDetails = hoistCmp.factory<TimelineDetailsProps>({
    displayName: 'ChatTimelineDetails',
    model: false,
    className: 'xh-chat-timeline__detail',

    render({className, part, spec, context}) {
        if (spec?.renderer) {
            return div({className, item: timelineRenderer({part, spec, context})});
        }

        const {state, output, errorText, toolName} = part,
            input = isEmpty(part.input) ? part.inputText : part.input;
        return div({
            className,
            items: [
                !isEmpty(input) ? pane('Input', toolName, input) : null,
                state === 'output-available' && output != null
                    ? pane('Output', isString(output) ? 'text' : 'json', output)
                    : null,
                state === 'output-error'
                    ? pane('Error', null, errorText || 'The tool failed.')
                    : null
            ]
        });
    }
});

// The tool's renderer, as a component of its own, so that it may call hooks. Takes any model in
// context, as `useLocalModel()` needs a model spec.
const timelineRenderer = hoistCmp.factory<TimelineDetailsProps>({
    displayName: 'ChatTimelineRenderer',
    model: uses('*', {optional: true}),

    render({part, spec, context}) {
        return spec.renderer(part, context) ?? null;
    }
});

function pane(label: string, sublabel: string, value: unknown): ReactNode {
    const text = toPaneText(value);
    return div({
        key: label,
        className: 'xh-chat-timeline__pane',
        role: 'group',
        'aria-label': label,
        items: [
            div({
                className: 'xh-chat-timeline__pane-head',
                items: [
                    span({className: 'xh-chat-timeline__pane-label', item: label}),
                    sublabel
                        ? span({className: 'xh-chat-timeline__pane-sub', item: sublabel})
                        : null,
                    span({className: 'xh-chat-timeline__pane-spacer'}),
                    chatCopyButton({getCopyText: () => text, label: `Copy ${label.toLowerCase()}`})
                ]
            }),
            paneBody(value)
        ]
    });
}

// A pane's body: one block per line, capped at 500 lines, scrolled inside its 240 px.
function paneBody(value: unknown): ReactNode {
    const lines = toPaneText(value).split('\n'),
        shown = lines.slice(0, TIMELINE_PANE_MAX_LINES);
    return [
        div({
            key: 'body',
            className: 'xh-chat-timeline__pane-body',
            tabIndex: 0,
            items: shown.map((line, idx) => div({key: idx, item: line || ' '}))
        }),
        lines.length > shown.length
            ? div({
                  key: 'more',
                  className: 'xh-chat-timeline__pane-more',
                  item: `Showing ${shown.length} of ${lines.length} lines`
              })
            : null
    ];
}

function toPaneText(value: unknown): string {
    if (value == null) return '';
    if (isString(value)) return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch (ignored) {
        return String(value);
    }
}

//------------------
// Implementation
//------------------
const DEFAULT_DENIAL = 'The user denied this tool call.';

const PLAN_ICONS = {
    done: () => Icon.check(),
    active: () => span({className: 'xh-chat-timeline__icon--busy', item: chatSpinner()}),
    pending: () => Icon.circle(),
    skipped: () => Icon.slashedCircle()
};
