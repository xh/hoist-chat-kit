import {findLast, findLastIndex, isFunction} from 'lodash';
import {
    type ComponentProps,
    type JSX,
    type MouseEvent,
    type ReactNode,
    useMemo,
    useRef
} from 'react';
import {a, div, img, span} from '@xh/hoist/cmp/layout';
import {Markdown, markdown} from '@xh/hoist/cmp/markdown';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {classNames} from '../../impl/ClassNames';
import '../../styles/vars.scss';
import './ChatMarkdown.scss';
import {closeMarkdownSyntax, isProseBlock, splitMarkdownBlocks} from './impl/StreamingMarkdown';

type ReactMarkdownOptions = NonNullable<ComponentProps<typeof Markdown>['reactMarkdownOptions']>;

/**
 * Components to render in place of standard HTML elements, keyed by tag name - for example
 * `{pre: myCodeBlock}`. Each receives the element's props, including `children`.
 */
export type ChatMarkdownComponents = ReactMarkdownOptions['components'];

/**
 * Which markdown images may load: true for all, false for none, or a function that decides by
 * source URL - for example to allow images from the app's own server only.
 */
export type ChatImagePolicy = boolean | ((src: string) => boolean);

/** True if an image policy allows the image at `src` to load. */
export function isChatImageAllowed(policy: ChatImagePolicy, src: string): boolean {
    if (!src) return false;
    return isFunction(policy) ? policy(src) : !!policy;
}

/** Props for {@link ChatMarkdown}. */
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

    /**
     * Images to load. Default false: an image renders as a link, labeled with its alt text, that
     * the user can choose to open. Loading an image sends a request to its URL, so a reply that a
     * prompt injection wrote could leak data in an image URL the moment it renders.
     *
     * A function is read as each image renders, so it need not be stable.
     */
    allowImages?: ChatImagePolicy;

    /**
     * Called when the user clicks a link, before the link opens. Read on each click, so it need
     * not be stable.
     */
    onLinkClick?: (href: string, e: MouseEvent<HTMLAnchorElement>) => void;

    /**
     * Inline content to show at the end of the last paragraph or list item, such as citation
     * markers. A code block, table, quote or heading at the end does not take it - the last
     * paragraph before them does. Content with no paragraph shows it on a line of its own, after
     * the content. Memoize it, as a new value re-renders the block that holds it.
     */
    trailingContent?: ReactNode;
}

/**
 * Renders markdown written by a language model, including while it streams.
 *
 * Supports GitHub Flavored Markdown (tables, task lists, strikethrough) via Hoist's `Markdown`
 * component. Links open in a new tab. Raw HTML in the content renders as plain text, never as
 * markup. Images do not load unless `allowImages` permits them.
 *
 * The content renders as a series of top-level blocks. Each block renders once and is then
 * memoized, so only the last block re-renders as text streams in. Content with reference-style
 * link definitions or footnotes renders as one document once streaming ends, so that references
 * resolve across blocks.
 */
export const [ChatMarkdown, chatMarkdown] = hoistCmp.withFactory<ChatMarkdownProps>({
    displayName: 'ChatMarkdown',
    model: false,
    className: 'xh-chat-markdown',

    render({
        className,
        content,
        isStreaming = false,
        components,
        lineBreaks = true,
        allowImages = false,
        onLinkClick,
        trailingContent
    }) {
        // Callbacks are read through refs, so that a new function does not re-parse every block.
        const linkClickRef = useRef(onLinkClick),
            imagePolicyRef = useRef(allowImages),
            trailingRef = useRef(trailingContent);
        linkClickRef.current = onLinkClick;
        imagePolicyRef.current = allowImages;
        trailingRef.current = trailingContent;

        const imagePolicyKey = isFunction(allowImages) ? 'fn' : !!allowImages,
            reactMarkdownOptions = useMemo(
                () => ({
                    components: {
                        a: createLink(linkClickRef),
                        img: createImage(imagePolicyRef),
                        [TRAILER_TAG]: createTrailer(trailingRef),
                        ...components
                    } as ChatMarkdownComponents
                }),
                // The policy is read through its ref - only a change of kind needs new options.
                // eslint-disable-next-line react-hooks/exhaustive-deps
                [components, imagePolicyKey]
            ),
            blocks = useMemo(
                () =>
                    isStreaming || !hasReferences(content)
                        ? splitMarkdownBlocks(content)
                        : [content],
                [content, isStreaming]
            ),
            lastIdx = blocks.length - 1,
            hasTrailer = trailingContent != null && trailingContent !== false,
            // The last prose block takes the trailing content - or else the last block, which then
            // shows it on a line of its own.
            proseIdx = hasTrailer ? findLastIndex(blocks, isProseBlock) : -1,
            trailerIdx = hasTrailer ? (proseIdx >= 0 ? proseIdx : lastIdx) : -1,
            // A new object when the content changes, so that the memoized block re-renders.
            trailerOptions = useMemo(
                () => ({...reactMarkdownOptions, rehypePlugins: [rehypeTrailer]}),
                // eslint-disable-next-line react-hooks/exhaustive-deps
                [reactMarkdownOptions, trailingContent]
            );

        return div({
            className: classNames(className, {'xh-chat-markdown--streaming': isStreaming}),
            // Hoist's markdown is memoized on its props, so a finished block renders once.
            items: blocks.map((block, idx) =>
                markdown({
                    key: idx,
                    content: isStreaming && idx === lastIdx ? closeMarkdownSyntax(block) : block,
                    lineBreaks,
                    reactMarkdownOptions: idx === trailerIdx ? trailerOptions : reactMarkdownOptions
                })
            )
        });
    }
});

//------------------
// Implementation
//------------------
type ElementProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & {
    node?: unknown;
};

// Reference definitions (`[id]: url`) and footnotes (`[^1]`) resolve only within one document.
const REFERENCE = /^ {0,3}\[[^\]]+\]:|\[\^/m;

function hasReferences(content: string): boolean {
    return REFERENCE.test(content ?? '');
}

function createLink(onLinkClickRef: {current: ChatMarkdownProps['onLinkClick']}) {
    return ({node, href, children, ...rest}: ElementProps<'a'>) =>
        a({
            ...rest,
            href,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick: e => onLinkClickRef.current?.(href, e),
            items: children
        });
}

// A blocked image renders as a link to the image, so that nothing loads until the user asks.
function createImage(policyRef: {current: ChatImagePolicy}) {
    return ({node, src, alt, ...rest}: ElementProps<'img'>): ReactNode => {
        const url = typeof src === 'string' ? src : null;
        if (isChatImageAllowed(policyRef.current, url)) return img({...rest, src: url, alt});

        const items = [Icon.fileImage(), alt || 'Image'];
        return url
            ? a({
                  className: BLOCKED_IMAGE_CLS,
                  href: url,
                  title: url,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  items
              })
            : span({className: BLOCKED_IMAGE_CLS, items});
    };
}

const BLOCKED_IMAGE_CLS = 'xh-chat-markdown__blocked-image';

// An element the rehype plugin below adds to the parsed markdown, rendered as the trailing content.
const TRAILER_TAG = 'xh-chat-markdown-trailer';

function createTrailer(trailingRef: {current: ReactNode}) {
    return () => trailingRef.current;
}

// Adds the trailer element to the end of the last paragraph or list item of the block - or, if it
// has none, as a paragraph of its own at the end. The tree is HTML AST (hast).
function rehypeTrailer() {
    return (tree: HastNode) => {
        const trailer: HastNode = {
                type: 'element',
                tagName: TRAILER_TAG,
                properties: {},
                children: []
            },
            target = findTrailerTarget(tree);
        if (target) {
            target.children.push(trailer);
        } else {
            tree.children.push({
                type: 'element',
                tagName: 'p',
                properties: {},
                children: [trailer]
            });
        }
    };
}

interface HastNode {
    type: string;
    tagName?: string;
    properties?: Record<string, unknown>;
    children?: HastNode[];
}

function findTrailerTarget(root: HastNode): HastNode {
    const elements = root.children.filter(it => it.type === 'element');
    for (let idx = elements.length - 1; idx >= 0; idx--) {
        const el = elements[idx];
        if (el.tagName === 'p') return el;
        if (isList(el)) return findListTarget(el);
    }
    return null;
}

// The last item of a list - its last paragraph in a loose list, or the end of a nested list.
function findListTarget(list: HastNode): HastNode {
    const item = findLast(list.children, it => it.tagName === 'li');
    if (!item) return null;
    const lastEl = findLast(item.children, it => it.type === 'element');
    if (lastEl?.tagName === 'p') return lastEl;
    if (lastEl && isList(lastEl)) return findListTarget(lastEl) ?? item;
    return item;
}

function isList(node: HastNode): boolean {
    return node.tagName === 'ul' || node.tagName === 'ol';
}
