import type {PlainObject} from '@xh/hoist/core';
import type {ChatUiDocument, ChatUiElement} from './ChatUiDocument';

/**
 * One piece of a text part, split by {@link ChatUiCatalog.parseText} into markdown and UI. Render
 * markdown segments as markdown, and the rest with {@link ChatUiCatalog.renderSegment}.
 */
export type ChatUiTextSegment =
    | ChatUiMarkdownSegment
    | ChatUiComponentSegment
    | ChatUiDocumentSegment
    | ChatUiPlaceholderSegment
    | ChatUiFallbackSegment;

/** Markdown text between UI. */
export interface ChatUiMarkdownSegment {
    type: 'markdown';
    text: string;
}

/** A complete tag that names a catalog component, with props that pass its checks. */
export interface ChatUiComponentSegment {
    type: 'component';

    /** The component and its props, parsed from the tag. */
    element: ChatUiElement;

    /**
     * The tag as written. The catalog reuses the segment of an earlier parse with the same format
     * and source, so a format must give equal elements for equal sources. Empty for none.
     */
    source: string;
}

/**
 * A nested answer in the text, complete or still streaming, from a {@link ChatUiTextFormat}. While
 * partial, elements that have not arrived render as placeholders.
 */
export interface ChatUiDocumentSegment {
    type: 'document';

    /** The answer, as the format parsed it so far. */
    document: ChatUiDocument;

    /** True while the answer is still streaming. */
    isPartial: boolean;

    /** The text the answer was parsed from. */
    source: string;

    /**
     * Problems the format found with elements of the answer, by element id, in the kit's
     * `path: message` form. Each such element renders as a fallback that lists them.
     */
    elementErrors?: Record<string, string[]>;
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

    /**
     * A line for the user that says why the content cannot show, in place of the catalog's
     * general line. For a reason the user can act on or pass on, such as a limit.
     */
    caption?: string;

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

/** Options for {@link ChatUiCatalog.parseText}. */
export interface ChatUiParseTextOptions {
    /**
     * True while the text is still streaming, so that UI still being written is held back. Default
     * false.
     */
    isStreaming?: boolean;

    /** Id of the message the text belongs to, for formats that keep state per part. */
    messageId?: string;

    /** Id of the text part, for formats that keep state per part. */
    partId?: string;
}
