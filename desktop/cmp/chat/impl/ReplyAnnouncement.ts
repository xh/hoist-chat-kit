import {compact} from 'lodash';
import {
    type ChatDataPart,
    type ChatMessage,
    type ChatTextPart,
    type ChatTranscript,
    isChatSubagentPart,
    isToolCallFailed
} from '../../../../core';
import {joinWithAnd} from './ChatFormat';
import {countTimelineWork} from './ChatTimelineItems';
import {getActivityDisplay, getToolCallDisplay, groupParts} from './groupParts';

/**
 * What the announcer reads when a reply finishes: who replied, after how many tools, counted
 * activities and agents, how long, and how many tools failed, then the reply's first paragraph as
 * plain text, cut at 300 characters. "Continues in the message." follows when more is left to
 * read. For example "Analyst replied after 7 tools and 1 agent, 42 seconds, 1 failed. HY Credit
 * is the only desk over its limit." This is also the activity timeline's done summary, which is
 * never announced alone.
 *
 * With a host to say how each tool displays, calls to `hidden` tools do not count, and narration
 * in an activity timeline is not read as the answer. Activities count only with a host, by the
 * `noun` of their type's spec, as in "after 5 tools and 2 skills". A host that draws reply text
 * with a `textRenderer` has its text read as the message's copy text, as its source may not be
 * words - and none of it without `getCopyText`.
 * @internal
 */
export function formatReplyAnnouncement(
    message: ChatMessage,
    assistantName: string,
    host: ChatTranscript = null
): string {
    const calls = message.toolCalls.filter(
            it => !host || getToolCallDisplay(it, host) !== 'hidden'
        ),
        activities = message.parts.filter(
            (it): it is ChatDataPart =>
                it.type === 'data' &&
                !isChatSubagentPart(it) &&
                getActivityDisplay(it, host) !== 'hidden'
        ),
        agentCount = message.parts.filter(isChatSubagentPart).length,
        failed = calls.filter(isToolCallFailed).length,
        secs = Math.round((message.metadata.elapsedMs ?? 0) / 1000),
        work = countTimelineWork({calls, activities, agentCount}, host),
        after = compact([
            joinWithAnd(work),
            secs ? plural(secs, 'second') : null,
            failed ? `${failed} failed` : null
        ]),
        head = `${assistantName} replied${after.length ? ` after ${after.join(', ')}` : ''}.`,
        {text, isPartial} = firstParagraph(getSpokenText(message, host));

    return compact([head, text, isPartial ? 'Continues in the message.' : null]).join(' ');
}

//------------------
// Implementation
//------------------
const MAX_CHARS = 300;

/** The text to read from a reply - see `formatReplyAnnouncement()`. */
function getSpokenText(message: ChatMessage, host: ChatTranscript): string {
    if (!host) return message.text;
    if (host.textRenderer) return host.getCopyText?.(message) ?? null;
    return getAnswerText(message, host);
}

/** The reply's text, less the narration that its activity timelines hold. */
function getAnswerText(message: ChatMessage, host: ChatTranscript) {
    const narrationIds = new Set(
        groupParts(message.parts, host).flatMap(group =>
            group.type === 'timeline' ? group.parts.map(it => it.id) : []
        )
    );
    return message.parts
        .filter(it => it.type === 'text' && !narrationIds.has(it.id))
        .map(it => (it as ChatTextPart).text)
        .join('\n\n');
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The first paragraph of markdown as plain text, and whether anything was left out. */
function firstParagraph(markdown: string): {text: string; isPartial: boolean} {
    const paragraphs = (markdown ?? '')
        .replace(/```[\s\S]*?(```|$)/g, '\n\n')
        .split(/\n\s*\n/)
        .map(toPlainText)
        .filter(Boolean);
    if (!paragraphs.length) return {text: null, isPartial: false};

    const [first] = paragraphs;
    if (first.length <= MAX_CHARS) return {text: first, isPartial: paragraphs.length > 1};

    const cut = first.slice(0, MAX_CHARS),
        lastSpace = cut.lastIndexOf(' ');
    return {text: `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`, isPartial: true};
}

/** Markdown as the words a screen reader should read - no markup, links or citation markers. */
function toPlainText(markdown: string): string {
    return markdown
        .replace(/<[^>]+>/g, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
        .replace(/[*_~`]+/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s+([.,;:!?])/g, '$1')
        .trim();
}
