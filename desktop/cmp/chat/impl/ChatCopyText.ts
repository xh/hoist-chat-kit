import type {ChatTextPart} from '../../../../core';
import type {ChatUiCatalog} from '../../../../genui';

/**
 * The words for text parts that hold UI, or null if none of them does. Each part reads as the
 * catalog's `toCopyText()` of its parsed segments, and parts join with blank lines. Copy and the
 * reply announcement share this, so that they say the same thing.
 * @internal
 */
export function getUiCopyText(
    parts: ChatTextPart[],
    messageId: string,
    catalog: ChatUiCatalog
): string {
    if (!catalog) return null;

    const segments = parts.map(it => catalog.parseText(it.text, {messageId, partId: it.id}));
    if (segments.every(list => list.every(it => it.type === 'markdown'))) return null;

    return segments.map(it => catalog.toCopyText(it)).join('\n\n');
}
