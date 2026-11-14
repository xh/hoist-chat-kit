import type {ChatUiCatalog} from '../../ChatUiCatalog';
import {toOpenUiLibrary, type OpenUiLibrary, type OpenUiLibraryOptions} from '../OpenUiLibrary';

/**
 * A function that returns the OpenUI library of a catalog, built on first use and kept for as
 * long as the catalog lives.
 * @internal
 */
export function createLibraryCache(
    opts: OpenUiLibraryOptions
): (catalog: ChatUiCatalog) => OpenUiLibrary {
    const libraries = new WeakMap<ChatUiCatalog, OpenUiLibrary>();
    return catalog => {
        let ret = libraries.get(catalog);
        if (!ret) {
            ret = toOpenUiLibrary(catalog, opts);
            libraries.set(catalog, ret);
        }
        return ret;
    };
}
