import {architectPrompt, libraryCatalogs, libraryRegistry} from './library.ts';

/** The library's Architect prompt, with chat answers and feature requests, as the scenarios use both. */
export const SYSTEM_PROMPT = architectPrompt({catalogs: libraryCatalogs, registry: libraryRegistry, withAnswers: true, withFeatureRequests: true});
