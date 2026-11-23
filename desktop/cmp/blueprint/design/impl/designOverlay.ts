import {div} from '@xh/hoist/cmp/layout';
import type {BlueprintDesignModel} from '../../../../../blueprint';
import {layoutGesture} from '../../../layout';
import type {OverlayMark, OverlayModel} from '../../../layout/overlay';
import {altHold} from './altHold';
import './designOverlay.scss';

const CLS = 'xh-blueprint-overlay',
    CELL = '[data-blueprint-view';

/**
 * Design mode's marks over a blueprint, outlines only: the hovered element's dashed outline, the
 * selected one's solid outline, and a selected view's outline over a tint. Structure, the
 * breadcrumb and the Inspector name the element. An element in a canvas cell is marked at its cell,
 * header included. None draw in run mode, or while a cell or view is being moved or resized.
 */
export function designMarks(
    designModel: BlueprintDesignModel,
    overlay: OverlayModel
): OverlayMark[] {
    const {blueprintModel, selectedElementId: selected, hoveredId: hovered} = designModel,
        elements = blueprintModel.blueprint?.elements;
    if (blueprintModel.mode !== 'design' || layoutGesture.active) return [];
    const ret: OverlayMark[] = [],
        outline = (kind: string) =>
            div({key: 'outline', className: `${CLS}__outline ${CLS}__outline--${kind}`});
    // In Interact, or with Alt held for one click, clicks reach the widgets: nothing marks a hover.
    if (
        hovered &&
        designModel.interaction === 'edit' &&
        !altHold.active &&
        hovered !== selected &&
        hovered !== designModel.selectedViewId &&
        elements?.[hovered]
    ) {
        ret.push({
            key: 'hover',
            target: targetOf(hovered, overlay),
            // A canvas is hovered at a gap between its cells, so its outline is faint.
            render: () => outline(elements[hovered].component === 'dashCanvas' ? 'faint' : 'hover')
        });
    }
    const view = designModel.selectedViewId;
    if (view && elements?.[view]) {
        ret.push({
            key: 'selection',
            target: targetOf(view, overlay),
            render: () => outline('view')
        });
    }
    if (selected && elements?.[selected]) {
        ret.push({
            key: 'selection',
            target: targetOf(selected, overlay),
            render: () => outline('selected')
        });
    }
    return ret;
}

//------------------
// Implementation
//------------------
// An element's canvas cell where it has one, so its marks frame the header too, else its wrapper.
function targetOf(id: string, overlay: OverlayModel): string {
    const cell = `${CELL}="${CSS.escape(id)}"]`;
    return overlay.hostEl?.querySelector(cell)
        ? cell
        : `[data-blueprint-element="${CSS.escape(id)}"]`;
}
