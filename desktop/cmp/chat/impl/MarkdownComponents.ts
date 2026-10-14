import {isValidElement, type ReactElement, useMemo} from 'react';
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

/**
 * Markdown element overrides used by the desktop chat components. A module-level constant, so
 * that memoized markdown blocks see the same object on every render.
 * @internal
 */
export const CHAT_MARKDOWN_COMPONENTS: ChatMarkdownComponents = {pre: MarkdownPre};

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
