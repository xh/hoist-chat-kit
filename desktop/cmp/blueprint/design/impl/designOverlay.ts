import {div, span} from '@xh/hoist/cmp/layout';
import classNames from 'classnames';
import type {BlueprintDesignModel} from '../../../../../blueprint';
import type {OverlayBox, OverlayMark, OverlayModel} from '../../../layout/overlay';
import {widgetIcon} from './icons';
import {selectionToolbar} from './SelectionToolbar';
import './designOverlay.scss';

const CLS = 'xh-blueprint-overlay',
    // The room a tag or the toolbar needs above its target, or it draws just inside.
    TAG_ROOM = 22,
    TOOLBAR_ROOM = 32;

/**
 * Design mode's marks over a blueprint: the hovered element's dashed outline and name tag, and
 * the selected one's outline with its toolbar as a tab on top. Each sits outside its element's
 * top-left, or just inside where there is no room, so neither covers the element's content. An
 * element in a canvas cell is marked at its cell, header included. None draw in run mode.
 */
export function designMarks(
    designModel: BlueprintDesignModel,
    overlay: OverlayModel
): OverlayMark[] {
    const {blueprintModel, selectedElementId: selected, hoveredId: hovered} = designModel;
    if (blueprintModel.mode !== 'design') return [];
    const ret: OverlayMark[] = [];
    if (hovered && hovered !== selected && blueprintModel.blueprint?.elements?.[hovered]) {
        ret.push({
            key: 'hover',
            target: targetOf(hovered, overlay),
            render: box => [
                div({key: 'outline', className: `${CLS}__outline ${CLS}__outline--hover`}),
                tag(designModel, hovered, box)
            ]
        });
    }
    if (selected && blueprintModel.blueprint?.elements?.[selected]) {
        ret.push({
            key: 'selection',
            target: targetOf(selected, overlay),
            render: box => [
                div({key: 'outline', className: `${CLS}__outline ${CLS}__outline--selected`}),
                selectionToolbar({
                    key: 'toolbar',
                    designModel,
                    id: selected,
                    inside: box.y < TOOLBAR_ROOM
                })
            ]
        });
    }
    return ret;
}

//------------------
// Implementation
//------------------
// An element's canvas cell where it has one, so its marks frame the header too, else its wrapper.
function targetOf(id: string, overlay: OverlayModel): string {
    const cell = `[data-blueprint-view="${CSS.escape(id)}"]`;
    return overlay.hostEl?.querySelector(cell)
        ? cell
        : `[data-blueprint-element="${CSS.escape(id)}"]`;
}

function tag(designModel: BlueprintDesignModel, id: string, box: OverlayBox) {
    const {registry, blueprint} = designModel.blueprintModel,
        spec = registry.widgets[blueprint.elements[id].component];
    return span({
        key: 'tag',
        className: classNames(`${CLS}__tag`, box.y < TAG_ROOM && `${CLS}__tag--inside`),
        children: [
            spec ? widgetIcon(spec, {className: `${CLS}__tag-icon`}) : null,
            spec ? `${id} · ${spec.label}` : id
        ]
    });
}
