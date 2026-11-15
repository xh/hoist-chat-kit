import {createContext, createElement, type ReactElement} from 'react';

/**
 * The direction of the stack that holds a component, for a component that draws itself to suit,
 * as a divider does. A component outside any stack reads `column`. Each container that lays its
children out in a column, such as a section, a form or tabs, sets `column`.
 * @internal
 */
export const ChatUiStackDirection = createContext<'column' | 'row'>('column');

/**
 * An element whose children lay out in a column, whatever the stack around it.
 * @internal
 */
export function inColumn(element: ReactElement): ReactElement {
    return createElement(ChatUiStackDirection.Provider, {value: 'column'}, element);
}
