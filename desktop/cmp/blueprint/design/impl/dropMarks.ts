import {div} from '@xh/hoist/cmp/layout';
import classNames from 'classnames';
import type {OverlayMark} from '../../../layout/overlay';
import type {DropPlace} from './dropTargets';
import './dropMarks.scss';

const CLS = 'xh-blueprint-drop';

/**
 * The marks of a drag over a blueprint: its target container outlined, and the line where it would
 * insert, or, where the container refuses it, the outline in danger and the reason at the pointer.
 * A canvas or a dash container draws its own preview, so only its outline shows here.
 */
export function dropMarks(place: DropPlace): OverlayMark[] {
    if (!place) return [];
    const {containerEl, refusal, line, pointer, ownDrop} = place;
    const ret: OverlayMark[] = [
        {
            key: 'drop',
            target: containerEl,
            render: () => [
                div({
                    key: 'outline',
                    className: classNames(`${CLS}__outline`, refusal && `${CLS}__outline--refused`)
                }),
                !refusal && line && !ownDrop ? insertLine(line) : null
            ]
        }
    ];
    if (refusal) {
        // The reason reads in full, even past the edge of a scrolled container.
        ret.push({
            key: 'drop-refusal',
            target: containerEl,
            clip: false,
            render: () =>
                div({
                    className: `${CLS}__refusal`,
                    style: {left: pointer.x + 12, top: pointer.y + 12},
                    children: `Can't drop here: ${refusal}`
                })
        });
    }
    return ret;
}

//------------------
// Implementation
//------------------
function insertLine({axis, at, from, to}: DropPlace['line']) {
    const style =
        axis === 'row'
            ? {left: at - 1, top: from, height: to - from}
            : {top: at - 1, left: from, width: to - from};
    return div({key: 'line', className: `${CLS}__line ${CLS}__line--${axis}`, style});
}
