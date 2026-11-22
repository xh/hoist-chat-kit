import {box, div, hbox, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, uses} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {pick, sortBy} from 'lodash';
import type {ReactNode} from 'react';
import {BlueprintWidgetModel, type ChildRef, type DashCanvasWidgetConfig} from '../../../blueprint';
import {gridCanvas, type GridCell} from '../layout';
import {CANVAS_GAP, emptyContent, resetLayoutButton} from './impl/layout';
import {paletteDrag} from './impl/paletteDrag';

/**
 * The `dashCanvas` widget: a grid canvas that places each child at the `x`, `y`, `w` and `h` of its
 * child reference. The references are the layout: a finished drag or resize is one edit of them,
 * in reading order, and the canvas keeps no copy.
 */
export class DashCanvasWidgetModel extends BlueprintWidgetModel<DashCanvasWidgetConfig> {
    /** The cells, as the child references place them. */
    get cells(): GridCell[] {
        const {blueprint, registry} = this.blueprintModel;
        return this.children.map(it => {
            const size = registry.widgets[blueprint?.elements?.[it.id]?.component]?.size?.min;
            return {
                id: it.id,
                ...(pick(it, 'x', 'y', 'w', 'h') as Omit<GridCell, 'id'>),
                ...(size?.w ? {minW: size.w} : {}),
                ...(size?.h ? {minH: size.h} : {})
            };
        });
    }

    get isDesign(): boolean {
        return this.blueprintModel.mode === 'design';
    }

    /**
     * Each cell's title, by ID: its reference's `title`, else its child's, with bindings and
     * variables resolved. Null for a cell with none.
     */
    get titles(): Record<string, string> {
        const {blueprintModel} = this,
            elements = blueprintModel.blueprint?.elements ?? {};
        return Object.fromEntries(
            this.children.map(ref => {
                const title = blueprintModel.resolveTitle(
                    (ref.title as string) ?? elements[ref.id]?.config?.title
                );
                return [ref.id, title == null || title === '' ? null : String(title)];
            })
        );
    }

    /**
     * Each cell's header items, by ID: the cell's own `headerItems`, then a panel child's, which
     * draws no header of its own in a cell.
     */
    get cellHeaderRefs(): Record<string, ChildRef[]> {
        const elements = this.blueprintModel.blueprint?.elements ?? {};
        return Object.fromEntries(
            this.children.map(({id}) => [
                id,
                [
                    ...this.slotRefs('headerItems', id),
                    ...(elements[id]?.component === 'panel'
                        ? ((elements[id].headerItems as ChildRef[]) ?? [])
                        : [])
                ]
            ])
        );
    }

    /** True if a cell draws a header: not hidden, and with a title or header items. */
    cellHasHeader(id: string): boolean {
        const ref = this.children.find(it => it.id === id);
        if (!ref || ref.hideHeader) return false;
        return this.titles[id] != null || this.cellHeaderRefs[id]?.length > 0;
    }

    /** A cell's header items: in design mode its element's id first, then its own items. */
    headerItemsFor(id: string): ReactNode[] {
        return [
            this.isDesign ? span({key: '_id', className: `${CLS}__cell-id`, children: id}) : null,
            ...(this.cellHeaderRefs[id] ?? []).map(it => this.renderElement(it.id))
        ].filter(Boolean);
    }

    /** True while a palette drag is in progress and the blueprint is open for design. */
    get takesDrop(): boolean {
        const {mode, access} = this.blueprintModel;
        return !!paletteDrag.current && mode === 'design' && access === 'write';
    }

    /** The size of a palette drag's cell, or false to refuse any other drag, or outside design. */
    onDropOver(): {w: number; h: number} | false {
        return this.takesDrop ? paletteDrag.current.size : false;
    }

    /** Add the palette drag's widget where it fell, with the other cells as the drop left them. */
    onDrop(place: Omit<GridCell, 'id'>, siblings: GridCell[]) {
        const drag = paletteDrag.current;
        paletteDrag.end();
        drag?.add(this.id, {
            child: pick(place, 'x', 'y', 'w', 'h'),
            siblings: siblings.map(it => ({...it}))
        });
    }

    /** True if a reader has moved or resized cells, which {@link resetLayout} undoes. */
    get isRearranged(): boolean {
        return this.blueprintModel.hasTransientValues(`/elements/${this.id}/children`);
    }

    /** Drop a reader's rearrangement, back to the blueprint's placement. */
    resetLayout() {
        this.blueprintModel.clearTransientValues(`/elements/${this.id}/children`);
    }

    /** Write moved or resized cells to the child references, as one edit, in reading order. */
    onCellsChange(changed: GridCell[]) {
        this.applyUserEdit([
            {op: 'set', path: `/elements/${this.id}/children`, value: this.childrenWith(changed)}
        ]);
    }

    /**
     * Move or resize a cell as a drag does, as one edit, or transient in run mode. Returns why it
     * was refused, or null: a place off the grid, under the cell's minimum size, or over another
     * cell, as free placement never overlaps. For tests and tools that drive the canvas without a
     * pointer, such as `XH.getModels('DashCanvasWidgetModel')` from DevTools.
     */
    moveCell(id: string, place: Partial<Omit<GridCell, 'id'>>): string {
        const {cells} = this,
            cell = cells.find(it => it.id === id);
        if (!cell) return `There is no cell '${id}'.`;
        const next = {...cell, ...pick(place, 'x', 'y', 'w', 'h')},
            columns = (this.resolvedConfig.columns as number) ?? 12,
            {x, y, w, h} = next;
        if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || x + w > columns) {
            return `'${id}' must lie on the grid, within its ${columns} columns.`;
        }
        if (w < (cell.minW ?? 1) || h < (cell.minH ?? 1)) {
            return `'${id}' is at least ${cell.minW ?? 1} by ${cell.minH ?? 1}.`;
        }
        const over = cells.find(
            it => it.id !== id && x < it.x + it.w && it.x < x + w && y < it.y + it.h && it.y < y + h
        );
        if (over) return `'${id}' would overlap '${over.id}'.`;
        const refusal = this.canApplyUserEdit([
            {op: 'set', path: `/elements/${this.id}/children`, value: this.childrenWith([next])}
        ]);
        if (refusal) return refusal;
        this.onCellsChange([next]);
        return null;
    }

    // The child references with cells moved, in reading order.
    private childrenWith(changed: GridCell[]): ChildRef[] {
        const byId = new Map(changed.map(it => [it.id, it]));
        return sortBy(
            this.children.map(ref =>
                byId.has(ref.id) ? {...ref, ...pick(byId.get(ref.id), 'x', 'y', 'w', 'h')} : ref
            ),
            ['y', 'x']
        );
    }
}

export const [DashCanvasWidget, dashCanvasWidget] = hoistCmp.withFactory({
    displayName: 'DashCanvasWidget',
    className: 'xh-blueprint-dash-canvas',
    model: uses(DashCanvasWidgetModel),
    render({model, className}) {
        const {columns = 12, rowHeight = 50} = model.resolvedConfig,
            // The hint lies over a live canvas, so an empty one still takes a drop.
            empty = emptyContent(model);
        return box({
            className,
            flex: 1,
            position: 'relative',
            children: [
                gridCanvas({
                    cells: model.cells,
                    editable: true,
                    showGrid: model.isDesign,
                    columns,
                    rowHeight,
                    margin: [CANVAS_GAP, CANVAS_GAP],
                    containerPadding: [CANVAS_GAP, CANVAS_GAP],
                    renderItem: id => model.renderElement(id),
                    renderHeader: id => (model.cellHasHeader(id) ? cellHeader({model, id}) : null),
                    // In design mode a headerless cell moves by a grip, which also selects its view.
                    renderGrip: id =>
                        model.isDesign
                            ? div({
                                  className: `${CLS}__grip`,
                                  title: `Move ${id}`,
                                  ...({'data-blueprint-view-grip': id} as PlainObject),
                                  children: Icon.gripVertical()
                              })
                            : null,
                    frameProps: id => ({
                        'data-blueprint-view': id,
                        'data-blueprint-canvas': model.id
                    }),
                    onChange: cells => model.onCellsChange(cells),
                    onDropOver: () => model.onDropOver(),
                    onDrop: (place, siblings) => model.onDrop(place, siblings)
                }),
                empty ? div({className: `${className}__empty`, children: empty}) : null,
                resetLayoutButton({omit: !model.isRearranged, onClick: () => model.resetLayout()})
            ]
        });
    }
});

//------------------
// Implementation
//------------------
const CLS = 'xh-blueprint-dash-canvas';

// A cell's header: its icon and title, then in design mode its element's id or toolbar, which
// gives way first, then its header items.
const cellHeader = hoistCmp.factory<HoistProps & {model: DashCanvasWidgetModel; id: string}>({
    displayName: 'DashCanvasCellHeader',
    model: false,
    render({model, id}) {
        const icon = model.blueprintModel.blueprint?.elements?.[id]?.config?.icon,
            title = model.titles[id];
        return hbox({
            className: `${CLS}__cell-header`,
            ...({'data-blueprint-view-header': true} as PlainObject),
            children: [
                icon ? Icon.icon({faName: icon, className: `${CLS}__cell-icon`}) : null,
                title != null ? span({className: `${CLS}__cell-title`, children: title}) : null,
                div({className: `${CLS}__cell-items`, children: model.headerItemsFor(id)})
            ]
        });
    }
});
