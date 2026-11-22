import {div, vbox} from '@xh/hoist/cmp/layout';
import {take} from 'lodash';
import type {ReactElement} from 'react';
import '../../../../styles/vars.scss';
import './ChatUiMore.scss';

/**
 * The first `max` of a list of items, and how many more there are. A spec shows the first ones
 * rather than fail the whole component, as a model that writes a few too many gets no retry.
 * @internal
 */
export function takeItems<T>(items: T[], max: number): {shown: T[]; hidden: number} {
    return {shown: take(items, max), hidden: Math.max(items.length - max, 0)};
}

/**
 * The element, with a muted note under it such as `4 more not shown`, when items were left out.
 * @internal
 */
export function withMoreNote(element: ReactElement, hidden: number): ReactElement {
    if (!(hidden > 0)) return element;
    return vbox({
        className: 'xh-chat-ui-more',
        children: [
            element,
            div({className: 'xh-chat-ui-more__note', children: `${hidden} more not shown`})
        ]
    });
}
