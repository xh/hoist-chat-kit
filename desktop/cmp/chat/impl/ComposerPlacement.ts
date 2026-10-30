import {createContext} from 'react';
import {elementFactory} from '@xh/hoist/core';

/**
 * True while `ChatPanel` shows its composer centered, with room below it. A composer pill then
 * opens its menu downward, so the menu does not cover the composer.
 * @internal
 */
export const ComposerCenteredContext = createContext(false);

/** @internal */
export const composerCenteredProvider = elementFactory(ComposerCenteredContext.Provider);

/**
 * Where a composer pill's popover opens: down while the composer is centered, else up, along the
 * pill's start or end edge.
 * @internal
 */
export function getPillPopoverPosition(
    isCentered: boolean,
    align: 'start' | 'end'
): 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' {
    return `${isCentered ? 'bottom' : 'top'}-${align === 'end' ? 'right' : 'left'}`;
}
