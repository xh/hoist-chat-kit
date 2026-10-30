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
