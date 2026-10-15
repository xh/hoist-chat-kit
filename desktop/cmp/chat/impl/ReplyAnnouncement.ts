import {compact} from 'lodash';
import type {ChatMessage} from '../../../../core';

/**
 * What the announcer reads when a reply finishes: who replied, after how many tools and how long,
 * then the reply's first paragraph as plain text, cut at 300 characters. "Continues in the
 * message." follows when more is left to read. For example "Analyst replied after 2 tools, 12
 * seconds. HY Credit is the only desk over its limit."
 * @internal
 */
export function formatReplyAnnouncement(message: ChatMessage, assistantName: string): string {
    const tools = message.toolCalls.length,
        secs = Math.round((message.metadata.elapsedMs ?? 0) / 1000),
        after = compact([
            tools ? plural(tools, 'tool') : null,
            secs ? plural(secs, 'second') : null
        ]),
        head = `${assistantName} replied${after.length ? ` after ${after.join(', ')}` : ''}.`,
        {text, isPartial} = firstParagraph(message.text);

    return compact([head, text, isPartial ? 'Continues in the message.' : null]).join(' ');
}

//------------------
// Implementation
//------------------
const MAX_CHARS = 300;

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
