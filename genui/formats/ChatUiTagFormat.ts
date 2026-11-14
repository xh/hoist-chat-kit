import type {ChatUiTextFormat} from '../ChatUiTextFormat';
import {createTagsSection} from '../impl/catalogPrompt';
import {parseTags} from '../impl/parseTags';

/**
 * The tag format, named `tags`: a self-closing component tag in the reply's markdown, such as
 * `<ui-grid data="sales" columns='["region","total"]'/>`, with the catalog's `tagPrefix`. Each tag
 * is one component. The default text format of a {@link ChatUiCatalog}.
 */
export function chatUiTagFormat(): ChatUiTextFormat {
    return {
        name: 'tags',
        parse: (text, {catalog, isStreaming}) =>
            parseTags(text, {
                prefix: catalog.tagPrefix,
                isStreaming,
                getComponent: name => catalog.getComponent(name),
                validate: (name, props) => catalog.validate(name, props)
            }),
        toPrompt: ({catalog}) => createTagsSection(catalog)
    };
}
