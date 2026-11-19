import {architectPrompt, libraryCatalogs, libraryRegistry} from './library.ts';

/** The library's Architect prompt, with chat answers, as the scenarios need show_ui. */
export const SYSTEM_PROMPT = architectPrompt({catalogs: libraryCatalogs, registry: libraryRegistry, withAnswers: true});
