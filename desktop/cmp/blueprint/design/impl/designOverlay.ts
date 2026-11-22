import {div, span} from '@xh/hoist/cmp/layout';
import classNames from 'classnames';
import type {BlueprintDesignModel} from '../../../../../blueprint';
import {layoutGesture} from '../../../layout';
import type {OverlayBox, OverlayMark, OverlayModel} from '../../../layout/overlay';
import {altHold} from './altHold';
import {widgetIcon} from './icons';
import {selectionToolbar} from './SelectionToolbar';
import './designOverlay.scss';

const CLS = 'xh-blueprint-overlay',
    // The room a tag or the toolbar needs above its target, up to the window's top, or it draws
    // just inside.
    TAG_ROOM = 22,
    TOOLBAR_ROOM = 32,
    CELL = '[data-blueprint-view';

/**
 * Design mode's marks over a blueprint: the hovered element's dashed outline and name tag, and
 * the selected one's outline with its toolbar as a tab on top. Each sits outside its element's
 * top-left, or just inside where there is no room, so neither covers the element's content. An
 * element in a canvas cell is marked at its cell, header included. None draw in run mode, or
 * while a cell or view is being moved or resized, so none follow the pointer or cover the gesture.
 */
export function designMarks(
    designModel: BlueprintDesignModel,
    overlay: OverlayModel
): OverlayMark[] {
    const {blueprintModel, selectedElementId: selected, hoveredId: hovered} = designModel;
    if (blueprintModel.mode !== 'design' || layoutGesture.active) return [];
    const ret: OverlayMark[] = [],
        surface = () => overlay.hostEl?.closest<HTMLElement>('.xh-panel__content[tabindex]');
    // In Interact, or with Alt held for one click, clicks reach the widgets: nothing marks a hover.
    if (
        hovered &&
        designModel.interaction === 'edit' &&
        !altHold.active &&
        hovered !== selected &&
        hovered !== designModel.selectedViewId &&
        blueprintModel.blueprint?.elements?.[hovered]
    ) {
        ret.push({
            key: 'hover',
            target: targetOf(hovered, overlay),
            // A canvas is hovered at a gap between its cells: a faint outline, and no tag.
            render: box =>
                blueprintModel.blueprint.elements[hovered].component === 'dashCanvas'
                    ? div({key: 'outline', className: `${CLS}__outline ${CLS}__outline--faint`})
                    : [
                          div({
                              key: 'outline',
                              className: `${CLS}__outline ${CLS}__outline--hover`
                          }),
                          tag(designModel, hovered, box)
                      ]
        });
    }
    const view = designModel.selectedViewId;
    if (view && blueprintModel.blueprint?.elements?.[view]) {
        ret.push({
            key: 'selection',
            target: `${CELL}="${CSS.escape(view)}"]`,
            render: box => [
                div({key: 'outline', className: `${CLS}__outline ${CLS}__outline--view`}),
                selectionToolbar({
                    key: 'toolbar',
                    designModel,
                    id: view,
                    isView: true,
                    inCell: true,
                    inside: box.roomAbove < TOOLBAR_ROOM,
                    surface
                })
            ]
        });
    }
    if (selected && blueprintModel.blueprint?.elements?.[selected]) {
        const target = targetOf(selected, overlay);
        ret.push({
            key: 'selection',
            target,
            render: box => [
                div({key: 'outline', className: `${CLS}__outline ${CLS}__outline--selected`}),
                selectionToolbar({
                    key: 'toolbar',
                    designModel,
                    id: selected,
                    inCell: target.startsWith(CELL),
                    inside: box.roomAbove < TOOLBAR_ROOM,
                    surface
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
    const cell = `${CELL}="${CSS.escape(id)}"]`;
    return overlay.hostEl?.querySelector(cell)
        ? cell
        : `[data-blueprint-element="${CSS.escape(id)}"]`;
}

function tag(designModel: BlueprintDesignModel, id: string, box: OverlayBox) {
    const {registry, blueprint} = designModel.blueprintModel,
        spec = registry.widgets[blueprint.elements[id].component];
    return span({
        key: 'tag',
        className: classNames(`${CLS}__tag`, box.roomAbove < TAG_ROOM && `${CLS}__tag--inside`),
        children: [
            spec ? widgetIcon(spec, {className: `${CLS}__tag-icon`}) : null,
            spec ? `${id} · ${spec.label}` : id
        ]
    });
}
