import {compact, findLast, findLastIndex, isEqual, isFunction} from 'lodash';
import {
    type ComponentProps,
    createContext,
    createElement,
    type JSX,
    type MouseEvent,
    type ReactElement,
    type ReactNode,
    useContext,
    useMemo,
    useRef
} from 'react';
import {a, div, fragment, img, span} from '@xh/hoist/cmp/layout';
import {Markdown, markdown} from '@xh/hoist/cmp/markdown';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {useCached} from '@xh/hoist/utils/react';
import type {ChatSourcePart} from '../../core';
import {classNames} from '../../impl/ClassNames';
import {htmlButton} from '../../impl/HtmlTags';
import '../../styles/vars.scss';
import './ChatMarkdown.scss';
import {
    findCitedSource,
    getCitationGroupLabels,
    getExcerpt,
    openSourceUrl
} from '../../impl/sources';
import {CITATION_TAG, remarkCitations} from './impl/CitationMarkers';
import {closeMarkdownSyntax, isProseBlock, splitMarkdownBlocks} from './impl/StreamingMarkdown';

type ReactMarkdownOptions = NonNullable<ComponentProps<typeof Markdown>['reactMarkdownOptions']>;

/**
 * A list of unified plugins, each a plugin or a `[plugin, options]` pair - the form that
 * `remark-*` and `rehype-*` packages take.
 */
export type ChatMarkdownPluggableList = NonNullable<ReactMarkdownOptions['remarkPlugins']>;

/**
 * Plugins to add to the markdown pipeline, after the kit's own - for example `remark-math` and
 * `rehype-katex` for math.
 */
export interface ChatMarkdownPlugins {
    /** Plugins that transform the markdown tree (mdast), such as `remark-math`. */
    remark?: ChatMarkdownPluggableList;

    /** Plugins that transform the HTML tree (hast), such as `rehype-katex`. */
    rehype?: ChatMarkdownPluggableList;
}

/** Sources that citation markers in the text refer to - see {@link ChatMarkdownProps.citations}. */
export interface ChatMarkdownCitations {
    /**
     * Sources the text may cite, in the order reported. `[n]` cites the source with `marker` n, or
     * the nth source when no source has a marker.
     */
    sources: ChatSourcePart[];

    /**
     * Called when the user clicks a citation marker. Default opens the source's `url` in a new
     * tab. Read on each click, so it need not be stable.
     */
    onClick?: (source: ChatSourcePart) => void;

    /**
     * Renders the button of a cited source in place of the default, for example to wrap it in a
     * card of the platform's own. Receives the default button, the source and the number that
     * cites it. Without it, the button shows the source title and excerpt as a native browser
     * tooltip. Read as each marker renders, so it need not be stable.
     */
    renderMarker?: (marker: ReactElement, source: ChatSourcePart, number: number) => ReactNode;

    /**
     * Renders the one button that stands for a marker of four or more sources, such as
     * `[2, 3, 4, 5]`, in place of the default. Receives the default button and the cited sources
     * with their numbers. The default button reads "2–5" for consecutive numbers, else "4
     * sources". Read as each marker renders.
     *
     * The default button lists every source in its tooltip, but a click opens only the first.
     * Replace it to give the user a way to open each source, as the desktop chat's card does.
     */
    renderGroup?: (marker: ReactElement, cited: ChatCitedSource[]) => ReactNode;
}

/** A source with the number that cites it - see {@link ChatMarkdownCitations.renderGroup}. */
export interface ChatCitedSource {
    number: number;
    source: ChatSourcePart;
}

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

    /**
     * Sources for citation markers. When set, `[1]` and `[1, 2]` in the text render as compact
     * buttons for the sources they cite, with each number in its own button. A marker with a
     * number that cites no source stays as written, as does a marker in code or in a link.
     *
     * The text re-parses when the sources change, so keep the array stable while they stay the
     * same. A new array of the same sources is fine.
     */
    citations?: ChatMarkdownCitations;

    /**
     * Plugins to add to the markdown pipeline, after the kit's own - see
     * {@link ChatMarkdownPlugins}. Pass a stable object, such as a module-level constant.
     */
    markdownPlugins?: ChatMarkdownPlugins;
}

/**
 * True while the markdown block that renders the caller is still streaming - for a component in
 * `components` that should wait for its content to end, such as a code block that collapses long
 * code. False in a finished block, and outside `ChatMarkdown`.
 */
export function useChatMarkdownStreaming(): boolean {
    return useContext(StreamingContext);
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
 *
 * With `citations` set, citation markers such as `[1]` render as buttons for the sources they
 * cite. `markdownPlugins` adds remark and rehype plugins, such as those for math.
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
        trailingContent,
        citations,
        markdownPlugins
    }) {
        // Callbacks are read through refs, so that a new function does not re-parse every block.
        const linkClickRef = useRef(onLinkClick),
            imagePolicyRef = useRef(allowImages),
            trailingRef = useRef(trailingContent),
            citationsRef = useRef(citations);
        linkClickRef.current = onLinkClick;
        imagePolicyRef.current = allowImages;
        trailingRef.current = trailingContent;
        citationsRef.current = citations;

        // Kept stable while the sources stay the same, so that the blocks re-parse only when the
        // sources change - not on every streamed flush.
        const sources = useCached(citations?.sources ?? null, isEqual),
            imagePolicyKey = isFunction(allowImages) ? 'fn' : !!allowImages,
            reactMarkdownOptions = useMemo(
                () => ({
                    components: {
                        a: createLink(linkClickRef),
                        img: createImage(imagePolicyRef),
                        [TRAILER_TAG]: createTrailer(trailingRef),
                        [CITATION_TAG]: createCitation(citationsRef),
                        ...components
                    } as ChatMarkdownComponents,
                    remarkPlugins: compact([
                        sources ? [remarkCitations, {sources}] : null,
                        ...(markdownPlugins?.remark ?? [])
                    ]) as ChatMarkdownPluggableList,
                    rehypePlugins: markdownPlugins?.rehype ?? []
                }),
                // The policy is read through its ref - only a change of kind needs new options.
                // eslint-disable-next-line react-hooks/exhaustive-deps
                [components, imagePolicyKey, sources, markdownPlugins]
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
                () => ({
                    ...reactMarkdownOptions,
                    rehypePlugins: [rehypeTrailer, ...reactMarkdownOptions.rehypePlugins]
                }),
                // eslint-disable-next-line react-hooks/exhaustive-deps
                [reactMarkdownOptions, trailingContent]
            );

        return div({
            className: classNames(className, {'xh-chat-markdown--streaming': isStreaming}),
            // Hoist's markdown is memoized on its props, so a finished block renders once. Each
            // block sits in a provider, so that its components see the end of streaming even when
            // the content of the last block does not change.
            items: blocks.map((block, idx) => {
                const isBlockStreaming = isStreaming && idx === lastIdx;
                return createElement(StreamingContext.Provider, {
                    key: idx,
                    value: isBlockStreaming,
                    children: markdown({
                        content: isBlockStreaming ? closeMarkdownSyntax(block) : block,
                        lineBreaks,
                        reactMarkdownOptions:
                            idx === trailerIdx ? trailerOptions : reactMarkdownOptions
                    })
                });
            })
        });
    }
});

//------------------
// Implementation
//------------------
type ElementProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & {
    node?: unknown;
};

const StreamingContext = createContext(false);

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

// Renders the element that the citation plugin puts in place of a marker, as a button per number -
// or one button for four or more.
function createCitation(citationsRef: {current: ChatMarkdownCitations}) {
    return ({'data-markers': markers}: {'data-markers'?: string}): ReactNode => {
        const {sources, onClick, renderMarker, renderGroup} = citationsRef.current ?? NO_CITATIONS,
            numbers: number[] = String(markers ?? '')
                .split(' ')
                .map(it => parseInt(it, 10)),
            cited = numbers.map(number => ({number, source: findCitedSource(sources, number)}));

        if (cited.length >= GROUP_MIN && cited.every(it => it.source)) {
            return span({className: CITATION_CLS, item: groupMarker(cited, onClick, renderGroup)});
        }

        return span({
            className: CITATION_CLS,
            items: cited.map(({number, source}) => {
                if (!source) return `[${number}]`;

                const label = getSourceLabel(source),
                    excerpt = getExcerpt(source),
                    marker = htmlButton({
                        key: number,
                        type: 'button',
                        className: `${CITATION_CLS}-marker`,
                        'aria-label': `Source ${number}: ${label}`,
                        title: renderMarker ? null : compact([label, excerpt]).join('\n\n'),
                        onClick: () => (onClick ?? openSourceUrl)(source),
                        item: String(number)
                    });
                return renderMarker
                    ? fragment({key: number, item: renderMarker(marker, source, number)})
                    : marker;
            })
        });
    };
}

// One button for a marker of many sources - labeled with the first and last numbers when they
// run in order, else with the count. A click opens the first source - `renderGroup` replaces the
// button to offer each.
function groupMarker(
    cited: ChatCitedSource[],
    onClick: (source: ChatSourcePart) => void,
    renderGroup: ChatMarkdownCitations['renderGroup']
): ReactNode {
    const {text, label} = getCitationGroupLabels(cited.map(it => it.number)),
        marker = htmlButton({
            type: 'button',
            className: `${CITATION_CLS}-marker ${CITATION_CLS}-marker--group`,
            'aria-label': label,
            title: renderGroup
                ? null
                : cited
                      .map(({number, source}) => `${number}. ${getSourceLabel(source)}`)
                      .join('\n'),
            onClick: () => (onClick ?? openSourceUrl)(cited[0].source),
            item: text
        });
    return renderGroup ? renderGroup(marker, cited) : marker;
}

function getSourceLabel({title, url}: ChatSourcePart): string {
    return title || url || 'Untitled';
}

const CITATION_CLS = 'xh-chat-markdown__citation',
    // Markers of this many sources or more collapse to one button.
    GROUP_MIN = 4,
    NO_CITATIONS: ChatMarkdownCitations = {sources: []};
