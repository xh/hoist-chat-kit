import type {ChatUiCatalog} from './ChatUiCatalog';
import type {ChatUiDocument} from './ChatUiDocument';

/**
 * Translates the UI payload of a generative UI protocol, such as OpenUI Lang or A2UI, into a
 * {@link ChatUiDocument} of components from a {@link ChatUiCatalog}. The payload arrives in a data
 * part, and the catalog renders the document in its place, so that a protocol's UI draws with the
 * app's own Hoist components.
 *
 * Register adapters through the catalog, as data renderers for the chat:
 *
 * ```ts
 * const chatModel = new ChatModel({
 *     transport,
 *     tools: catalog.tools,
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
     * @param payload - the `data` of the data part.
     * @param catalog - the catalog that renders the result - for example to look up components.
     */
    translate(payload: any, catalog: ChatUiCatalog): ChatUiDocument;
}
