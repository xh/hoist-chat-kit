import {createContext} from 'react';

/**
 * The direction of the stack that holds a component, for a component that draws itself to suit,
 * as a divider does. A component outside any stack reads `column`.
 * @internal
 */
export const ChatUiStackDirection = createContext<'column' | 'row'>('column');
