import {isValidElement, type ReactElement, useMemo} from 'react';
import {table} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import type {ChatMarkdownComponents} from '../../../../cmp/markdown';
import {chatCodeBlock} from '../ChatCodeBlock';

// Markdown renders a fenced code block as `pre > code.language-xyz`. Swap the `pre` for a
// ChatCodeBlock, reading the code and its language from the inner `code` element.
const MarkdownPre = hoistCmp<HoistProps>({
    displayName: 'ChatMarkdownPre',
    model: false,
    observer: false,

    render({children}) {
        const codeEl = isValidElement(children)
                ? (children as ReactElement<{className?: string; children?: unknown}>)
                : null,
            {className, children: text} = codeEl?.props ?? {},
            language = /language-(\S+)/.exec(className ?? '')?.[1] ?? null;

        return chatCodeBlock({content: String(text ?? '').replace(/\n$/, ''), language});
    }
});

interface HastElement {
    type: string;
    tagName?: string;
    children?: HastElement[];
}

// A markdown table renders plain, in a frame that fits its content, on Hoist's compact grid
// tokens. One with more body rows than the preview holds scrolls inside its frame, under a sticky
// header.
// TODO(design-open B1) - a larger table renders as the preview card of P4, with View Full Table.
const MarkdownTable = hoistCmp<HoistProps & {node?: HastElement}>({
    displayName: 'ChatMarkdownTable',
    model: false,
    observer: false,

    render({node, children}) {
        return table({
            className:
                countBodyRows(node) > MAX_PLAIN_TABLE_ROWS
                    ? 'xh-chat-markdown__table--scroll'
                    : null,
            items: children
        });
    }
});

// Markdown tables of up to this many body rows show in full.
const MAX_PLAIN_TABLE_ROWS = 12;

function countBodyRows(node: HastElement): number {
    const body = node?.children?.find(it => it.tagName === 'tbody');
    return body?.children?.filter(it => it.tagName === 'tr').length ?? 0;
}

/**
 * Markdown element overrides used by the desktop chat components. A module-level constant, so
 * that memoized markdown blocks see the same object on every render.
 * @internal
 */
export const CHAT_MARKDOWN_COMPONENTS: ChatMarkdownComponents = {
    pre: MarkdownPre,
    table: MarkdownTable
};

/**
 * The kit's markdown components, with an app's overrides merged over them. Memoized, so that
 * markdown blocks see a stable object while the overrides stay the same.
 * @internal
 */
export function useChatMarkdownComponents(
    overrides: ChatMarkdownComponents
): ChatMarkdownComponents {
    return useMemo(
        () => (overrides ? {...CHAT_MARKDOWN_COMPONENTS, ...overrides} : CHAT_MARKDOWN_COMPONENTS),
        [overrides]
    );
}
