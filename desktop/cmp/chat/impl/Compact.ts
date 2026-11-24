import {ChatKit} from '../../../../core';

/**
 * True if a chat of this width shows at compact density - `ChatKit.defaults.compactMaxWidth` or
 * less.
 * @internal
 */
export function isCompactWidth(width: number): boolean {
    const max = ChatKit.defaults.compactMaxWidth;
    return width != null && max != null && width <= max;
}
