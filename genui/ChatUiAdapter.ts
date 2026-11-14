import type {ChatUiCatalog} from './ChatUiCatalog';
import type {ChatUiDocument} from './ChatUiDocument';

/** What a {@link ChatUiAdapter} gets with each payload. */
export interface ChatUiAdapterContext {
    /** The catalog that renders the result - for example to look up components. */
    catalog: ChatUiCatalog;

    /**
     * True while the reply that holds the data part still streams. A protocol that sends a growing
     * document gets it again as it grows. It may return the part that has arrived so far, with
     * the document's `isPartial` set from this flag.
     */
    isPartial: boolean;
}

/**
 * Translates the UI payload of a generative UI protocol, such as OpenUI Lang or A2UI, into a
 * {@link ChatUiDocument} of components from a {@link ChatUiCatalog}. The payload arrives in a data
 * part, and the catalog renders the document in its place, so that a protocol's UI draws with the
 * app's own Hoist components.
 *
 * Pass the catalog to the chat, and register adapters through it as data renderers:
 *
 * ```ts
 * const chatModel = new ChatModel({
 *     transport,
 *     catalog,
 *     dataRenderers: catalog.createDataRenderers([myProtocolAdapter])
 * });
 * ```
 */
export interface ChatUiAdapter {
    /** The `dataType` of the data parts this adapter handles - for example `openui` or `a2ui`. */
    dataType: string;

    /**
     * Translate a payload into a document of catalog components. Map the protocol's component
     * names to catalog names, and its component ids to element ids. Leave out anything the
     * catalog cannot show. The catalog repairs and checks the document before it renders, and
     * renders an element that fails its checks as a fallback.
     *
     * The catalog renders the result as partial only if its `isPartial` is true - then a missing
     * element renders as a placeholder. An adapter for a protocol that streams sets it from
     * `context.isPartial`. A `translate()` that throws renders a placeholder while the reply
     * streams, and a fallback once it ends.
     *
     * @param payload - the `data` of the data part.
     * @param context - the catalog that renders the result, and whether the reply still streams.
     */
    translate(payload: any, context: ChatUiAdapterContext): ChatUiDocument;
}
