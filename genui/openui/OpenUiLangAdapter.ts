import {throwIf} from '@xh/hoist/utils/js';
import {createParser} from '@openuidev/lang-core';
import {isString} from 'lodash';
import type {ChatUiAdapter} from '../ChatUiAdapter';
import {openUiToDocument} from './OpenUiDocument';
import {getOpenUiFeatures, type OpenUiLangFormatOptions} from './OpenUiLangFormat';
import {createLibraryCache} from './impl/libraryCache';
import {createOpenUiStateSpec} from './impl/openUiStateSpec';

/** Options for {@link openUiLangAdapter}. */
export interface OpenUiLangAdapterOptions extends OpenUiLangFormatOptions {
    /** The `dataType` of the data parts that hold a program. Default `openui`. */
    dataType?: string;
}

/**
 * An adapter that renders an OpenUI Lang program sent in a data part, for a server that sends UI
 * apart from the reply's text. The part's `data` is the program, or an object with the program
 * in `program`. The program becomes a document of catalog components, as with
 * {@link openUiLangFormat}, and runs with state under the same `bindings` and `builtinFunctions`
 * options. Register it with {@link ChatUiCatalog.createDataRenderers}.
 */
export function openUiLangAdapter(opts: OpenUiLangAdapterOptions): ChatUiAdapter {
    const {dataType = 'openui', ...libraryOpts} = opts,
        features = getOpenUiFeatures(opts),
        getLibrary = createLibraryCache({
            ...libraryOpts,
            bindings: features.bindings,
            toolCalls: features.toolCalls
        });

    return {
        dataType,
        translate(payload, {catalog, isPartial}) {
            const program = isString(payload) ? payload : payload?.program;
            throwIf(
                !isString(program),
                `'${dataType}' data must be an OpenUI Lang program, or an object with the ` +
                    'program in `program`.'
            );

            const library = getLibrary(catalog),
                result = createParser(library.schema, library.root).parse(program),
                translation = openUiToDocument(result, library, {
                    complete: !isPartial,
                    text: program,
                    catalog
                });
            // A program cut off when the reply ended is complete: nothing more will arrive.
            const isDocumentPartial = isPartial && translation.isPartial,
                state = features.hasState
                    ? createOpenUiStateSpec(result, library, {
                          catalog,
                          text: program,
                          isComplete: !isDocumentPartial,
                          isTextComplete: !isPartial,
                          logKey: program,
                          runtime: features.runtime
                      })
                    : null;
            return {
                ...translation.document,
                isPartial: isDocumentPartial,
                ...(state ? {state} : {})
            };
        }
    };
}
