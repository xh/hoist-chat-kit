import {grid, GridModel} from '@xh/hoist/cmp/grid';
import {div, vframe} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    type PlainObject,
    useLocalModel
} from '@xh/hoist/core';
import type React from 'react';
import type {BlueprintDesignModel} from '../../../../blueprint';
import {slotLists} from '../../../../blueprint/impl/elements';
import './ElementOutline.scss';

export interface ElementOutlineProps extends HoistProps {
    designModel: BlueprintDesignModel;
}

/**
 * The tree of a blueprint's elements, each with its widget, for a designer to see the layout and
 * select an element. Its selection is the design model's. In design mode, a row drags: onto a
 * container to move into it, or onto the top or bottom of any row to move before or after it.
 */
export const [ElementOutline, elementOutline] = hoistCmp.withFactory<ElementOutlineProps>({
    displayName: 'BlueprintElementOutline',
    className: 'xh-blueprint-element-outline',
    model: false,
    render({designModel, className}) {
        const impl = useLocalModel(() => new ElementOutlineModel(designModel));
        return vframe({
            className,
            children: grid({model: impl.gridModel})
        });
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
            {
                field: 'id',
                headerName: 'Element',
                isTreeColumn: true,
                flex: 1,
                renderer: (id: string) => this.renderRow(id)
            },
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

    /** Where a drop on a row goes, from how far down the row it falls, from 0 to 1. */
    whereFor(targetId: string, fraction: number): 'into' | 'before' | 'after' {
        const isContainer =
            !!this.designModel.blueprintModel.registry.widgets[
                this.designModel.blueprintModel.blueprint?.elements?.[targetId]?.component
            ]?.children;
        if (isContainer && fraction > 0.25 && fraction < 0.75) return 'into';
        return fraction < 0.5 ? 'before' : 'after';
    }

    /** Move a dragged element onto a row, as one edit, or say why it cannot go there. */
    drop(id: string, targetId: string, where: 'into' | 'before' | 'after') {
        if (!id || id === targetId) return;
        const {designModel} = this,
            error = designModel
                .moveTo(id, targetId, where)
                .issues.find(it => it.severity === 'error');
        if (error) designModel.blueprintModel.showRefusal(error);
    }

    //------------------
    // Implementation
    //------------------
    private dragging: string = null;

    private get canMove(): boolean {
        const {mode, access} = this.designModel.blueprintModel;
        return mode === 'design' && access === 'write';
    }

    private renderRow(id: string) {
        const where = (e: React.DragEvent) => {
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
            return this.whereFor(id, box.height ? (e.clientY - box.top) / box.height : 0.5);
        };
        return div({
            className: ROW,
            draggable: this.canMove,
            onDragStart: (e: React.DragEvent) => {
                this.dragging = id;
                e.dataTransfer.setData('text/plain', id);
            },
            onDragEnd: () => (this.dragging = null),
            onMouseEnter: () => this.designModel.setHovered(id),
            onMouseLeave: () => {
                if (this.designModel.hoveredId === id) this.designModel.setHovered(null);
            },
            onDragOver: (e: React.DragEvent) => {
                if (!this.dragging || this.dragging === id) return;
                e.preventDefault();
                (e.currentTarget as HTMLElement).dataset.drop = where(e);
            },
            onDragLeave: (e: React.DragEvent) =>
                delete (e.currentTarget as HTMLElement).dataset.drop,
            onDrop: (e: React.DragEvent) => {
                e.preventDefault();
                delete (e.currentTarget as HTMLElement).dataset.drop;
                this.drop(this.dragging, id, where(e));
                this.dragging = null;
            },
            children: id
        });
    }

    private loadRows() {
        const {blueprintModel} = this.designModel,
            {blueprint, registry} = blueprintModel,
            elements = blueprint?.elements ?? {},
            placed = new Set<string>(),
            toRow = (id: string, slot = 'children', of: string = null): PlainObject => {
                placed.add(id);
                const el = elements[id],
                    label = registry.widgets[el.component]?.label ?? el.component;
                return {
                    id,
                    widget: slot === 'children' ? label : `${label} · ${slotName(slot, of)}`,
                    children: slotLists(el).flatMap(list =>
                        list.refs
                            .filter(it => Object.hasOwn(elements, it.id) && !placed.has(it.id))
                            .map(it => toRow(it.id, list.slot, list.of))
                    )
                };
            },
            roots =
                blueprint?.root && Object.hasOwn(elements, blueprint.root)
                    ? [toRow(blueprint.root)]
                    : [];
        this.gridModel.loadData(roots);
    }
}

const ROW = 'xh-blueprint-element-outline__row';

// A slot as the outline names it: a cell's header by the cell, any other by its key.
function slotName(slot: string, of: string): string {
    return of ? `${of} ${slot === 'headerItems' ? 'header' : slot}` : slot;
}
