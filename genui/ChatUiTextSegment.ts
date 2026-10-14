import type {PlainObject} from '@xh/hoist/core';
import type {ChatUiElement} from './ChatUiDocument';

/**
 * One piece of a text part, split by {@link ChatUiCatalog.parseTags} into markdown and component
 * tags. Render markdown segments as markdown, and the rest with
 * {@link ChatUiCatalog.renderSegment}.
 */
export type ChatUiTextSegment =
    | ChatUiMarkdownSegment
    | ChatUiComponentSegment
    | ChatUiPlaceholderSegment
    | ChatUiFallbackSegment;

/** Markdown text between tags. */
export interface ChatUiMarkdownSegment {
    type: 'markdown';
    text: string;
}

/** A complete tag that names a catalog component, with props that pass its checks. */
export interface ChatUiComponentSegment {
    type: 'component';

    /** The component and its props, parsed from the tag. */
    element: ChatUiElement;

    /** The tag as written. */
    source: string;
}

/** A tag at the end of text that is still streaming - held back until it closes. */
export interface ChatUiPlaceholderSegment {
    type: 'placeholder';

    /** Name of the component, once the tag names a catalog component. Else null. */
    component: string;

    /** The tag so far. */
    source: string;
}

/** A tag that cannot render: an unknown component, invalid props, or broken markup. */
export interface ChatUiFallbackSegment {
    type: 'fallback';

    /** Name of the component the tag names, or null if it names no catalog component. */
    component: string;

    /** The component name in the tag, as written - a catalog component's or not. */
    name: string;

    /** The props parsed from the tag, if its attributes could be read. */
    props: PlainObject;

    /** What is wrong, in the kit's `path: message` form. */
    errors: string[];

    /** The tag as written. */
    source: string;
}

/** Options for {@link ChatUiCatalog.parseTags}. */
export interface ChatUiParseTagsOptions {
    /**
     * True while the text is still streaming. A tag cut off at the end of the text becomes a
     * placeholder segment, and a partial tag opening, such as `<ui-`, is held back. Default false:
     * an unclosed tag is a fallback segment.
     */
    isStreaming?: boolean;
}
