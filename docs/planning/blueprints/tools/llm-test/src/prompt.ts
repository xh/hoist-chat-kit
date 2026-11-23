import {architectPrompt, libraryCatalogs, libraryRegistry} from './library.ts';

/** The library's Architect prompt, with chat answers, feature requests and the UI context, as the scenarios use all three. */
export const SYSTEM_PROMPT = architectPrompt({catalogs: libraryCatalogs, registry: libraryRegistry, withAnswers: true, withFeatureRequests: true, withUiContext: true});
