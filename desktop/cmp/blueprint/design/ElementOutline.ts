import {grid, GridModel} from '@xh/hoist/cmp/grid';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    type PlainObject,
    useLocalModel
} from '@xh/hoist/core';
import type {BlueprintDesignModel} from '../../../../blueprint';

export interface ElementOutlineProps extends HoistProps {
    designModel: BlueprintDesignModel;
}

/**
 * The tree of a blueprint's elements, each with its widget, for a designer to see the layout and
 * select an element. Its selection is the design model's.
 */
export const [ElementOutline, elementOutline] = hoistCmp.withFactory<ElementOutlineProps>({
    displayName: 'BlueprintElementOutline',
    className: 'xh-blueprint-element-outline',
    model: false,
    render({designModel, className}) {
        const impl = useLocalModel(() => new ElementOutlineModel(designModel));
        return grid({model: impl.gridModel, className});
    }
});

/** @internal */
export class ElementOutlineModel extends HoistModel {
    @managed readonly gridModel = new GridModel({
        treeMode: true,
        hideHeaders: true,
        expandLevel: -1,
        emptyText: 'No elements yet.',
        store: {fields: ['widget']},
        columns: [
            {field: 'id', headerName: 'Element', isTreeColumn: true, flex: 1},
            {field: 'widget', headerName: 'Widget', width: 110}
        ]
    });

    constructor(private readonly designModel: BlueprintDesignModel) {
        super();
        this.addReaction(
            {
                track: () => this.designModel.blueprintModel.blueprint,
                run: () => this.loadRows(),
                fireImmediately: true
            },
            {
                track: () => this.gridModel.selectedId,
                run: id => {
                    if (id != null && id !== this.designModel.selectedElementId) {
                        this.designModel.select({kind: 'element', id: String(id)});
                    }
                }
            },
            {
                track: () => this.designModel.selectedElementId,
                run: id => {
                    if (id === this.gridModel.selectedId) return;
                    if (id) {
                        this.gridModel.selectAsync(id, {ensureVisible: true});
                    } else {
                        this.gridModel.clearSelection();
                    }
                },
                fireImmediately: true
            }
        );
    }

    private loadRows() {
        const {blueprintModel} = this.designModel,
            {blueprint, registry} = blueprintModel,
            elements = blueprint?.elements ?? {},
            placed = new Set<string>(),
            toRow = (id: string): PlainObject => {
                placed.add(id);
                const el = elements[id];
                return {
                    id,
                    widget: registry.widgets[el.component]?.label ?? el.component,
                    children: (el.children ?? [])
                        .filter(it => Object.hasOwn(elements, it.id) && !placed.has(it.id))
                        .map(it => toRow(it.id))
                };
            },
            roots =
                blueprint?.root && Object.hasOwn(elements, blueprint.root)
                    ? [toRow(blueprint.root)]
                    : [];
        this.gridModel.loadData(roots);
    }
}
