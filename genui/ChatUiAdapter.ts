import type {ChatUiCatalog} from './ChatUiCatalog';
import type {ChatUiNode} from './ChatUiComponentSpec';

/**
 * Translates the UI payload of a generative UI protocol, such as OpenUI Lang or A2UI, into
 * components from a {@link ChatUiCatalog}. The payload arrives in a data part, and the catalog
 * renders the translated components in its place, so that a protocol's UI draws with the app's
 * own Hoist components.
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
     * Translate a payload into catalog components, in display order. Map the protocol's component
     * names to catalog names, and leave out anything the catalog cannot show. The catalog checks
     * each node's props before it renders.
     *
     * @param payload - the `data` of the data part.
     * @param catalog - the catalog that renders the result - for example to look up components.
     */
    translate(payload: any, catalog: ChatUiCatalog): ChatUiNode[];
}
