import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import classNames from 'classnames';
import {isEqual} from 'lodash';
import {useLayoutEffect, useRef, useState} from 'react';
import type {OverlayBox, OverlayMark} from '../../../layout/overlay';
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
        // Placed whole within the blueprint area, so no scrolled container inside it cuts it.
        ret.push({
            key: 'drop-refusal',
            target: containerEl,
            clip: false,
            render: box => refusalChip({box, pointer, text: `Can't drop here: ${refusal}`})
        });
    }
    return ret;
}

/**
 * Where a chip of a size goes by the pointer, within an area, as a tooltip does: below and right
 * of it, or on its other side on an axis where that passes the area's edge, then shifted along the
 * edge if it still does not fit.
 */
export function chipPlace(
    pointer: {x: number; y: number},
    size: {width: number; height: number},
    area: {width: number; height: number}
): {left: number; top: number} {
    const along = (at: number, length: number, room: number) => {
        const after = at + GAP;
        if (after + length <= room) return after;
        return Math.max(0, Math.min(at - GAP - length, room - length));
    };
    return {
        left: along(pointer.x, size.width, area.width),
        top: along(pointer.y, size.height, area.height)
    };
}

//------------------
// Implementation
//------------------
const GAP = 12;

// The pointer is relative to the target's box, and the chip is placed within the whole area.
const refusalChip = hoistCmp.factory<
    HoistProps & {box: OverlayBox; pointer: {x: number; y: number}; text: string}
>({
    displayName: 'BlueprintDropRefusal',
    model: false,
    render({box, pointer, text}) {
        const ref = useRef<HTMLDivElement>(null),
            [size, setSize] = useState({width: 0, height: 0});
        useLayoutEffect(() => {
            const el = ref.current;
            if (!el) return;
            const next = {width: el.offsetWidth, height: el.offsetHeight};
            setSize(prev => (isEqual(prev, next) ? prev : next));
        }, [text]);
        const at = chipPlace({x: box.x + pointer.x, y: box.y + pointer.y}, size, box.area);
        return div({
            ref,
            className: `${CLS}__refusal`,
            style: {left: at.left - box.x, top: at.top - box.y},
            children: text
        });
    }
});
function insertLine({axis, at, from, to}: DropPlace['line']) {
    const style =
        axis === 'row'
            ? {left: at - 1, top: from, height: to - from}
            : {top: at - 1, left: from, width: to - from};
    return div({key: 'line', className: `${CLS}__line ${CLS}__line--${axis}`, style});
}
