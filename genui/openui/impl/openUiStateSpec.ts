import type {ParseResult} from '@openuidev/lang-core';
import type {ChatUiCatalog} from '../../ChatUiCatalog';
import type {ChatUiStateSpec} from '../../ChatUiState';
import {getOpenStatement, openUiToDocument} from '../OpenUiDocument';
import type {OpenUiLibrary} from '../OpenUiLibrary';
import {trimOpenTemplate} from './openTemplate';
import {OpenUiRuntime, type OpenUiRuntimeConfig, warnOfEvaluationErrors} from './OpenUiRuntime';

/** Options for {@link createOpenUiStateSpec}. */
export interface OpenUiStateSpecOptions {
    catalog: ChatUiCatalog;

    /** The program text that the result was parsed from. */
    text: string;

    /** True once the program has streamed in full. Its queries run from then on. */
    isComplete: boolean;

    /** True once the text that holds the program has stopped streaming. */
    isTextComplete: boolean;

    /** Names the program in the log, so that a warning about it logs once. */
    logKey: string;

    /** Settings of the runtime, beyond the catalog and the library. */
    runtime?: Partial<OpenUiRuntimeConfig>;
}

/**
 * The state spec of an OpenUI Lang program that runs with state. The catalog creates one
 * {@link OpenUiRuntime} per rendered program, and keeps it while the program streams. Each render
 * hands the runtime the program as last parsed, evaluates its props against the `$variables` and
 * the query results, and translates the result into a document.
 * @internal
 */
export function createOpenUiStateSpec(
    result: ParseResult,
    library: OpenUiLibrary,
    opts: OpenUiStateSpecOptions
): ChatUiStateSpec<OpenUiRuntime> {
    const {catalog, text, isComplete, isTextComplete, logKey} = opts,
        // While the text streams, the template at the end of the open statement may be cut.
        program = isTextComplete ? result : trimOpenTemplate(result, getOpenStatement(text));
    return {
        create: context => new OpenUiRuntime({catalog, library, context, ...opts.runtime}),
        resolve: runtime => {
            runtime.setProgram(program, text, isComplete);
            const {root, errors} = runtime.evaluateProgram(),
                {document} = openUiToDocument({...program, root}, library, {
                    complete: isTextComplete,
                    text,
                    catalog,
                    runtime
                });
            if (isComplete) warnOfEvaluationErrors(logKey, errors);
            return document;
        }
    };
}
