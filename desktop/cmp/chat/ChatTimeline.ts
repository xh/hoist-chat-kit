import {compact} from 'lodash';
import {type ReactNode, useEffect, useId, useLayoutEffect, useRef} from 'react';
import {button} from '@xh/hoist/desktop/cmp/button';
import {div, span, ul} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {pluralize} from '@xh/hoist/utils/js';
import {useComposedRefs, useOnResize} from '@xh/hoist/utils/react';
import {
    ChatKit,
    type ChatMessage,
    type ChatPart,
    type ChatPartRenderContext,
    type ChatToolCallPart,
    type ChatTranscript,
    isChatModel,
    isToolCallFinal
} from '../../../core';
import '../../../styles/vars.scss';
import {classNames} from '../../../impl/ClassNames';
import {chatElapsed} from './ChatElapsed';
import './ChatTimeline.scss';
import {chatToolCall} from './ChatToolCall';
import {formatStallDuration, joinWithAnd} from './impl/ChatFormat';
import {chatSpinner} from '../../impl/ChatLiveCues';
import {
    buildTimelineItems,
    type ChatTimelineState,
    type ChatTimelineSummary,
    countTimelineWork,
    describeActivity,
    getTimelineState,
    summarizeTimeline
} from './impl/ChatTimelineItems';
import {ChatTimelineLocalModel} from './impl/ChatTimelineLocalModel';
import {timelineRows} from './impl/ChatTimelineRows';
import {chatToolApproval, focusReplyOf} from './impl/ChatToolApproval';
import {getHostActivitySpec, getHostToolSpec, groupParts} from './impl/groupParts';
import {useChatClock} from './impl/useChatClock';
import {getToolTitle} from './impl/ToolCallStatus';

/** Props for {@link ChatTimeline}. */
export interface ChatTimelineProps extends HoistProps {
    /** The reply whose activity the timeline sums up. */
    message: ChatMessage;

    /**
     * The conversation that holds the reply, for its tool specs. A `ChatModel` also approves and
     * denies calls. Any other {@link ChatTranscript} shows the calls read-only.
     */
    host: ChatTranscript;

    /**
     * The parts the block holds: calls to `timeline` tools, `timeline` activities, sub-agents, and
     * the narration and reasoning between them. Default those of the reply's first timeline block.
     */
    parts?: ChatPart[];

    /**
     * Render context of the reply, passed to tool renderers. The message view passes its own.
     * Default one for the reply and its host.
     */
    context?: ChatPartRenderContext;

    /**
     * True if more of the reply follows the block. Once the work is done, the answer below it
     * turns the line to its summary while the reply still streams. Default false.
     */
    isFollowed?: boolean;

    /**
     * True if the reply is the last of the conversation, whose turn the chat's activity time
     * belongs to - for the quiet state. Default false.
     */
    isLast?: boolean;
}

/**
 * The activity timeline of an agent's reply: one compact block that sums up its run, for calls to
 * tools with `display: 'timeline'` and for activities with `display: 'timeline'`, such as the
 * skills an agent loads. The message view renders one in place of those parts.
 *
 * The block is one 28 px line that keeps its height in every state. While the agent works, it
 * shows the current step - the latest sentence of narration, or the running call - with the step
 * count and the time so far. With no data for the chat's stall time, it names what it waits on.
 * Once done, it reads "Used 7 tools and 1 agent", with the time taken and any failures in the
 * warning color. A call that waits for approval shows its approval panel under the line, open or
 * not. A call that waits for an answer shows its tool call card there, with the tool's `renderer`
 * open, as the user answers through it. Each waiting call has its own panel or card, and either
 * frames the block in the attention color.
 *
 * The line is a button that opens the block. Open, it shows a tree of rows: each call with its
 * status, title, input, and time; batches of repeated calls; activities; sub-agents with their
 * calls and activities nested under them; reasoning; and narration. A row opens to its input and
 * output, mounted only while open. The tree is one tab stop, with arrow keys between rows. The
 * block never opens or closes by itself. Below 480 px it drops the step count first.
 *
 * A step that fails is announced as it happens. The done summary is not: it rides in the reply's
 * own announcement.
 */
export const [ChatTimeline, chatTimeline] = hoistCmp.withFactory<ChatTimelineProps>({
    displayName: 'ChatTimeline',
    className: 'xh-chat-timeline',

    render(props, ref) {
        const {className, message, host, isFollowed = false, isLast = false} = props,
            chatModel = isChatModel(host) ? host : null,
            impl = useLocalModel(ChatTimelineLocalModel),
            bodyId = useId(),
            rootRef = useComposedRefs(
                useOnResize(rect => impl.setWidth(rect.width)),
                ref
            ),
            parts = getBlockParts(props),
            context = props.context ?? {chatModel, host, messageId: message.id},
            items = buildTimelineItems(parts, host),
            summary = summarizeTimeline(items, host),
            isLive = message.isStreaming,
            now = useChatClock(isLive),
            lastActivityAt = isLast && isLive ? (chatModel?.lastActivityAt ?? null) : null,
            stallAfterMs = chatModel?.stallAfterMs ?? ChatKit.defaults.stallAfterMs,
            quietMs = lastActivityAt != null ? now - lastActivityAt : null,
            state = getTimelineState({
                message,
                summary,
                isFollowed,
                isQuiet: quietMs != null && quietMs >= stallAfterMs
            }),
            {isExpanded, isNarrow} = impl;

        useEffect(() => {
            impl.steps.note(summary.calls, {
                isLive: isLive || message.status === 'paused',
                host
            });
            impl.noteQuiet(state === 'quiet' ? quietMs : null, runningTitle(summary, host));
        });

        const firstRowId = items[0]?.id ?? null,
            rowCtx = {
                impl,
                host,
                context,
                isStopped: state === 'stopped',
                isLive,
                tabStopId: impl.focusId ?? firstRowId
            };

        return div({
            ref: rootRef,
            className: classNames(className, `xh-chat-timeline--${state}`, {
                'xh-chat-timeline--expanded': isExpanded,
                'xh-chat-timeline--narrow': isNarrow,
                'xh-chat-timeline--attention': state === 'approval' || state === 'question'
            }),
            role: 'group',
            'aria-label': 'Activity',
            items: [
                button({
                    className: 'xh-chat-timeline__head',
                    'aria-expanded': isExpanded,
                    'aria-controls': isExpanded ? bodyId : undefined,
                    onClick: () => impl.toggle(),
                    text: span({
                        className: 'xh-chat-timeline__line',
                        items: [
                            span({
                                className: 'xh-chat-timeline__head-icon',
                                item: lineIcon(state)
                            }),
                            lineStage(state, summary, host, impl, now),
                            lineMeta(state, summary, message, impl, quietMs),
                            span({
                                className: 'xh-chat-timeline__chevron',
                                item: isExpanded
                                    ? Icon.groupRowExpanded()
                                    : Icon.groupRowCollapsed()
                            })
                        ]
                    })
                }),
                // Pending approvals and questions show whether or not the block is open.
                ...(state === 'approval' && chatModel
                    ? summary.approvals.map(part =>
                          chatToolApproval({
                              key: part.id,
                              className: 'xh-chat-timeline__ask',
                              part,
                              spec: getHostToolSpec(host, part.toolName),
                              chatModel
                          })
                      )
                    : []),
                ...(state === 'question'
                    ? summary.questions.map(part => timelineQuestion({key: part.id, part, context}))
                    : []),
                isExpanded
                    ? div({
                          id: bodyId,
                          className: 'xh-chat-timeline__body',
                          item: items.length
                              ? ul({
                                    ref: impl.treeRef,
                                    className: 'xh-chat-timeline__tree',
                                    role: 'tree',
                                    'aria-label': 'Steps',
                                    onKeyDown: impl.onTreeKeyDown,
                                    onFocus: impl.onTreeFocus,
                                    items: timelineRows(items, rowCtx)
                                })
                              : null
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
function getBlockParts(props: ChatTimelineProps): ChatPart[] {
    const {parts, message, host} = props;
    if (parts) return parts;
    const block = groupParts(message.parts, host).find(it => it.type === 'timeline');
    return block?.type === 'timeline' ? block.parts : [];
}

function lineIcon(state: ChatTimelineState): ReactNode {
    switch (state) {
        case 'running':
        case 'quiet':
            return span({className: 'xh-chat-timeline__icon--busy', item: chatSpinner()});
        case 'approval':
        case 'question':
            return span({className: 'xh-chat-timeline__icon--attention', item: Icon.pauseCircle()});
        case 'paused':
            return Icon.pauseCircle();
        case 'stopped':
            return Icon.stopCircle();
        case 'failed':
            return span({className: 'xh-chat-timeline__icon--error', item: Icon.xCircle()});
        default:
            return Icon.tools();
    }
}

function lineStage(
    state: ChatTimelineState,
    summary: ChatTimelineSummary,
    host: ChatTranscript,
    impl: ChatTimelineLocalModel,
    now: number
): ReactNode {
    const {calls} = summary,
        stage = (text: string, isNarration: boolean = false) =>
            span({
                className: classNames('xh-chat-timeline__stage', {
                    'xh-chat-timeline__stage--narration': isNarration
                }),
                title: text,
                item: text
            });

    switch (state) {
        case 'running':
            // Narration that the app draws itself may not be words, so its source never shows.
            if (summary.narration && !host?.textRenderer) {
                return stage(impl.holdStage(summary.narration, now), true);
            }
            return stage(impl.holdStage(runningStage(summary, host), now));
        case 'quiet': {
            const title = runningTitle(summary, host);
            return stage(title ? `Waiting on ${title}` : 'Waiting for a response');
        }
        case 'approval':
            return stage('Waiting for approval');
        case 'question':
            return stage('Waiting for your answer');
        case 'paused':
            return stage('Paused');
        case 'stopped': {
            const ran = calls.filter(it => isToolCallFinal(it) && !it.cancelled).length;
            return stage(`Stopped after ${pluralize('tool', ran, true)}`);
        }
        case 'failed':
            return stage(`Ended at step ${calls.length}`);
        default:
            return stage(usedLabel(summary, host, impl.isNarrow));
    }
}

function runningStage(summary: ChatTimelineSummary, host: ChatTranscript): string {
    const {running, runningAgents, activity, isThinking} = summary;
    if (running.length > 1) return `Running ${running.length} steps`;
    if (running.length === 1) return runningTitle(summary, host);
    if (runningAgents.length) return runningAgents[runningAgents.length - 1].name;
    if (activity) {
        const {title, summary: text} = describeActivity(
            activity,
            getHostActivitySpec(host, activity.dataType)
        );
        return compact([title, text]).join(': ');
    }
    return isThinking ? 'Thinking' : 'Working';
}

// The title of the newest running call, or of the newest running sub-agent.
function runningTitle(summary: ChatTimelineSummary, host: ChatTranscript): string {
    const call = summary.running[summary.running.length - 1];
    if (call) return getToolTitle(call, getHostToolSpec(host, call.toolName));
    const agent = summary.runningAgents[summary.runningAgents.length - 1];
    return agent?.name ?? null;
}

/**
 * "Used 13 tools, 2 skills and 1 agent" - or "Used 13 tools, 2 skills, 1 agent" when narrow.
 * Activities count by their type's noun. "Done" for a block with nothing that counts.
 */
function usedLabel(summary: ChatTimelineSummary, host: ChatTranscript, isNarrow: boolean): string {
    const work = countTimelineWork(summary, host);
    if (!work.length) return 'Done';
    return `Used ${isNarrow ? work.join(', ') : joinWithAnd(work)}`;
}

function lineMeta(
    state: ChatTimelineState,
    summary: ChatTimelineSummary,
    message: ChatMessage,
    impl: ChatTimelineLocalModel,
    quietMs: number
): ReactNode {
    const {calls, failedCount, isAllRetried} = summary,
        {isNarrow} = impl,
        isWorking = ['running', 'quiet', 'approval', 'question', 'paused'].includes(state),
        progress =
            isWorking && !isNarrow && calls.length ? pluralize('step', calls.length, true) : null,
        cancelled =
            state === 'stopped'
                ? calls.filter(it => it.cancelled || !isToolCallFinal(it)).length
                : 0,
        segments: ReactNode[] = compact([
            state === 'quiet' && !isNarrow && quietMs != null
                ? `no update for ${formatStallDuration(quietMs)}`
                : null,
            progress,
            cancelled && !isNarrow ? `${cancelled} cancelled` : null,
            state === 'failed' && !isNarrow ? pluralize('tool', calls.length, true) : null,
            elapsed(message, summary, state)
        ]);

    if (failedCount) {
        segments.push(
            span({
                key: 'fails',
                className: 'xh-chat-timeline__fails',
                items: [
                    Icon.warning(),
                    isNarrow
                        ? span({
                              title: `${failedCount} failed`,
                              'aria-label': `${failedCount} failed`,
                              item: failedCount
                          })
                        : `${failedCount} failed${isAllRetried ? ', retried' : ''}`
                ]
            })
        );
    }

    return span({
        className: 'xh-chat-timeline__meta',
        items: segments.flatMap((it, idx) =>
            idx
                ? [
                      span({
                          key: `sep${idx}`,
                          className: 'xh-chat-timeline__sep',
                          'aria-hidden': true,
                          item: ' · '
                      }),
                      it
                  ]
                : [it]
        )
    });
}

// Time since the reply began: live while it runs, else fixed at its end.
function elapsed(
    message: ChatMessage,
    summary: ChatTimelineSummary,
    state: ChatTimelineState
): ReactNode {
    const {createdAt, metadata} = message;
    if (message.isStreaming && state !== 'done') {
        return chatElapsed({key: 'elapsed', startedAt: createdAt});
    }
    const lastEnd = Math.max(0, ...summary.calls.map(it => it.endedAt ?? 0)),
        endedAt =
            metadata?.elapsedMs != null
                ? createdAt + metadata.elapsedMs
                : lastEnd > createdAt
                  ? lastEnd
                  : null;
    return endedAt != null ? chatElapsed({key: 'elapsed', startedAt: createdAt, endedAt}) : null;
}

//------------------
// Question
//------------------
interface TimelineQuestionProps extends HoistProps {
    part: ChatToolCallPart;
    context: ChatPartRenderContext;
}

/**
 * The card of a call that waits for an answer, with the tool's renderer open. Once answered, the
 * card goes, and focus inside it moves to the reply rather than to the page.
 */
const timelineQuestion = hoistCmp.factory<TimelineQuestionProps>({
    displayName: 'ChatTimelineQuestion',
    model: false,

    render({part, context}) {
        const ref = useRef<HTMLDivElement>(null);

        // A layout cleanup runs while the card is still in the document.
        useLayoutEffect(() => {
            const el = ref.current;
            return () => {
                if (el?.contains(document.activeElement)) focusReplyOf(el);
            };
        }, []);

        return div({ref, className: 'xh-chat-timeline__ask', item: chatToolCall({part, context})});
    }
});
