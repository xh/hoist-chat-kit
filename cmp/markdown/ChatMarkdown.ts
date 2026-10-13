import {type ComponentProps, type MouseEvent, useMemo} from 'react';
import {a, div} from '@xh/hoist/cmp/layout';
import {Markdown, markdown} from '@xh/hoist/cmp/markdown';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import '../../styles/vars.scss';
import './ChatMarkdown.scss';
import {closeMarkdownSyntax, splitMarkdownBlocks} from './impl/StreamingMarkdown';

type ReactMarkdownOptions = NonNullable<ComponentProps<typeof Markdown>['reactMarkdownOptions']>;

/**
 * Components to render in place of standard HTML elements, keyed by tag name - for example
 * `{pre: myCodeBlock}`. Each receives the element's props, including `children`.
 */
export type ChatMarkdownComponents = ReactMarkdownOptions['components'];

export interface ChatMarkdownProps extends HoistProps {
    /** Markdown text to render. */
    content: string;

    /**
     * True while `content` is still arriving. Renders incrementally - re-rendering only the last
     * block, with any unterminated syntax closed - so that long replies stream smoothly.
     */
    isStreaming?: boolean;

    /**
     * Components to render in place of standard elements, such as a code block for `pre`. Pass
     * a stable object (for example, a module-level constant) to keep renders cheap.
     */
    components?: ChatMarkdownComponents;

    /** True (default) to render single line breaks as line breaks. */
    lineBreaks?: boolean;

    /** Called when the user clicks a link, before the link opens. */
    onLinkClick?: (href: string, e: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Renders markdown written by a language model, including while it streams.
 *
 * Supports GitHub Flavored Markdown (tables, task lists, strikethrough) via Hoist's `Markdown`
 * component. Links open in a new tab. Raw HTML in the content renders as plain text, never as
 * markup.
 *
 * While `isStreaming`, the content renders as a series of blocks: finished blocks render once,
 * and only the last block re-renders as text arrives. Once streaming ends, the full content
 * renders as one document, so that footnotes and reference-style links resolve.
 */
export const [ChatMarkdown, chatMarkdown] = hoistCmp.withFactory<ChatMarkdownProps>({
    displayName: 'ChatMarkdown',
    model: false,
    className: 'xh-chat-markdown',

    render({className, content, isStreaming = false, components, lineBreaks = true, onLinkClick}) {
        const options = useMemo(
                () => ({components: {a: createLink(onLinkClick), ...components}}),
                [components, onLinkClick]
            ),
            blocks = useMemo(
                () => (isStreaming ? splitMarkdownBlocks(content) : null),
                [content, isStreaming]
            );

        if (!blocks) {
            return div({
                className,
                item: markdown({content: content ?? '', lineBreaks, reactMarkdownOptions: options})
            });
        }

        const lastIdx = blocks.length - 1;
        return div({
            className: `${className} xh-chat-markdown--streaming`,
            items: blocks.map((block, idx) =>
                markdownBlock({
                    key: idx,
                    content: idx === lastIdx ? closeMarkdownSyntax(block) : block,
                    lineBreaks,
                    options
                })
            )
        });
    }
});

//------------------
// Implementation
//------------------
// Memoized on its props, so a finished block - whose content no longer changes - renders once.
const markdownBlock = hoistCmp.factory<
    HoistProps & {content: string; lineBreaks: boolean; options: ReactMarkdownOptions}
>({
    displayName: 'ChatMarkdownBlock',
    model: false,
    observer: false,

    render({content, lineBreaks, options}) {
        return markdown({content, lineBreaks, reactMarkdownOptions: options});
    }
});

function createLink(onLinkClick: ChatMarkdownProps['onLinkClick']) {
    return ({node, href, children, ...rest}: ComponentProps<'a'> & {node?: unknown}) =>
        a({
            ...rest,
            href,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick: onLinkClick ? e => onLinkClick(href, e) : undefined,
            items: children
        });
}
