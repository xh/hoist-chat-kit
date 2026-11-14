import type {PlainObject} from '@xh/hoist/core';
import type {ChatUiCatalog, ChatUiPromptOptions} from './ChatUiCatalog';
import type {ChatUiTextSegment} from './ChatUiTextSegment';

/**
 * A grammar for UI in reply text. A format splits the text into markdown and UI segments as it
 * streams, and writes the prompt section that teaches the model its grammar. Configure formats
 * with {@link ChatUiCatalogConfig.textFormats}, and name one in `modes` to explain it to the
 * model. The kit's tag grammar, {@link chatUiTagFormat}, is the default.
 */
export interface ChatUiTextFormat {
    /** Name of the format, and its delivery mode in {@link ChatUiCatalogConfig.modes}. */
    name: string;

    /**
     * Changes when the format's options change the prompt or the parse. Hashed into the catalog's
     * version when set.
     */
    version?: string;

    /**
     * Split text into markdown and UI segments, in order. Called on every change while the text
     * streams. Text that holds no UI of the format is one markdown segment, and empty text none.
     * A component segment's `source` must determine its element - see
     * {@link ChatUiComponentSegment.source}. If `parse` throws, the text stays markdown.
     *
     * A parser that keeps state per part must key it by `messageId`, `partId` and `index`, and
     * must not rely on the ids being set.
     */
    parse(text: string, ctx: ChatUiFormatContext): ChatUiTextSegment[];

    /** The prompt section for the format: its grammar and the components it can show. */
    toPrompt(ctx: Pick<ChatUiFormatContext, 'catalog'>, opts: ChatUiPromptOptions): string;

    /** The format's own part of {@link ChatUiCatalog.toExport}, for a server, if it has one. */
    toExport?(ctx: Pick<ChatUiFormatContext, 'catalog'>): PlainObject;
}

/** Passed to each method of a {@link ChatUiTextFormat}. */
export interface ChatUiFormatContext {
    /** The catalog that runs the format. */
    catalog: ChatUiCatalog;

    /** True while the text is still streaming, so that it may end in UI still being written. */
    isStreaming: boolean;

    /**
     * Id of the message and part the text belongs to - for a parser that keeps state per part.
     * Null for text outside a chat.
     */
    messageId: string | null;
    partId: string | null;

    /**
     * Index of the markdown piece this call parses, among those the earlier formats left. 0 for
     * the first format, and for the first piece.
     */
    index: number;
}
