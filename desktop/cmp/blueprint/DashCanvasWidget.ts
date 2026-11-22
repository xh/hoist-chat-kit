import {box, div, hbox, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, uses} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {differenceWith, isEqual, pick, sortBy} from 'lodash';
import type {ReactNode} from 'react';
import {
    BlueprintWidgetModel,
    CANVAS_COLUMNS,
    type ChildRef,
    type DashCanvasWidgetConfig
} from '../../../blueprint';
import {
    compactCells,
    gridCanvas,
    type GridCanvasChange,
    type GridCell,
    type GridCompact,
    placeCell
} from '../layout';
import {widgetIcon} from './design/impl/icons';
import {CANVAS_GAP, emptyContent, resetLayoutButton} from './impl/layout';
import {containerAt} from './design/impl/dropTargets';
import {currentDropSource, elementDrag} from './design/impl/elementDrag';
import {paletteDrag} from './impl/paletteDrag';

/**
 * The `dashCanvas` widget: a grid canvas that places each child at the `x`, `y`, `w` and `h` of its
 * child reference. The references are the layout: a finished drag or resize is one edit of them,
 * in reading order, and the canvas keeps no copy.
 */
export class DashCanvasWidgetModel extends BlueprintWidgetModel<DashCanvasWidgetConfig> {
    /** The cells, as the child references place them. */
    get cells(): GridCell[] {
        const {blueprint, registry} = this.blueprintModel,
            cells = this.children.map(it => {
                const size = registry.widgets[blueprint?.elements?.[it.id]?.component]?.size?.min;
                return {
                    id: it.id,
                    ...(pick(it, 'x', 'y', 'w', 'h') as Omit<GridCell, 'id'>),
                    ...(size?.w ? {minW: size.w} : {}),
                    ...(size?.h ? {minH: size.h} : {})
                };
            });
        return compactCells(cells, this.settings);
    }

    /** The canvas's settings, with Hoist's DashCanvas defaults. */
    get settings(): CanvasSettings {
        const config = this.resolvedConfig,
            margin = (config.margin ?? [CANVAS_GAP, CANVAS_GAP]) as [number, number];
        return {
            columns: config.columns ?? CANVAS_COLUMNS,
            rowHeight: config.rowHeight ?? 50,
            compact: config.compact ?? 'vertical',
            preventCollision: !!config.preventCollision,
            margin,
            containerPadding: (config.containerPadding as [number, number]) ?? margin,
            maxRows: config.maxRows ?? Infinity,
            showGridBackground: !!config.showGridBackground,
            layoutLocked: !!config.layoutLocked
        };
    }

    /** True if a reader may not move or resize cells, as `layoutLocked` says. Design mode may. */
    get isLocked(): boolean {
        return this.settings.layoutLocked && !this.isDesign;
    }

    get isDesign(): boolean {
        return this.blueprintModel.mode === 'design';
    }

    /**
     * Each cell's title, by ID: its reference's `title`, else its child's, with bindings and
     * variables resolved, else its widget's label, else its ID.
     */
    get titles(): Record<string, string> {
        const {blueprintModel} = this,
            {registry} = blueprintModel,
            elements = blueprintModel.blueprint?.elements ?? {};
        return Object.fromEntries(
            this.children.map(ref => {
                const element = elements[ref.id],
                    title = blueprintModel.resolveTitle(
                        (ref.title as string) ?? element?.config?.title
                    );
                return [
                    ref.id,
                    title == null || title === ''
                        ? (registry.widgets[element?.component]?.label ?? ref.id)
                        : String(title)
                ];
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

    /**
     * True if a cell draws a header, which it moves by: always, unless it hides it, when it moves
     * by a grip in design mode.
     */
    cellHasHeader(id: string): boolean {
        const ref = this.children.find(it => it.id === id);
        return !!ref && !ref.hideHeader;
    }

    /** A cell's header items: in design mode its element's id first, then its own items. */
    headerItemsFor(id: string): ReactNode[] {
        return [
            // A cell titled by its ID already shows it.
            this.isDesign && this.titles[id] !== id
                ? span({key: '_id', className: `${CLS}__cell-id`, children: id})
                : null,
            ...(this.cellHeaderRefs[id] ?? []).map(it => this.renderElement(it.id))
        ].filter(Boolean);
    }

    /** True while a palette drag is in progress and the blueprint is open for design. */
    get takesDrop(): boolean {
        const {mode, access} = this.blueprintModel;
        return !!currentDropSource() && mode === 'design' && access === 'write';
    }

    /**
     * The size of the cell a drag would make, or false to refuse it: outside design, or over a
     * container inside a cell, which takes the drag itself.
     */
    onDropOver(e?: DragEvent): {w: number; h: number} | false {
        const source = currentDropSource();
        if (!this.takesDrop) return false;
        if (
            e &&
            containerAt(e.target as Element, this.blueprintModel, source)?.dataset
                .blueprintElement !== this.id
        ) {
            return false;
        }
        if ('widget' in source) return paletteDrag.current.size;
        const {blueprint, registry} = this.blueprintModel,
            size =
                registry.widgets[blueprint?.elements?.[source.element]?.component]?.size?.default;
        return {w: size?.w ?? 4, h: size?.h ?? 2};
    }

    /**
     * Drop the drag where it fell: a palette widget, with the other cells as the drop left them,
     * or an element moved here, as one edit.
     */
    onDrop(place: Omit<GridCell, 'id'>, siblings: GridCell[]) {
        const moving = elementDrag.current;
        if (moving) {
            elementDrag.end();
            moving.designModel.dropAt(
                {element: moving.element},
                {container: this.id, cell: pick(place, 'x', 'y', 'w', 'h')}
            );
            return;
        }
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

    /**
     * Write moved or resized cells to the child references, as one edit named for the change, in
     * reading order.
     */
    onCellsChange(changed: GridCell[], change?: GridCanvasChange) {
        this.applyUserEdit(
            [{op: 'set', path: `/elements/${this.id}/children`, value: this.childrenWith(changed)}],
            change ? `${change.kind === 'resize' ? 'Resize' : 'Move'} ${change.id}` : null
        );
    }

    /**
     * Move or resize a cell as a drag does, as one edit, or transient in run mode: the cells it
     * lands on move down. Returns why it was refused, or null: a place off the grid, or under the
     * cell's minimum size. For tests and tools that drive the canvas without a
     * pointer, such as `XH.getModels('DashCanvasWidgetModel')` from DevTools.
     */
    moveCell(id: string, place: Partial<Omit<GridCell, 'id'>>): string {
        const {cells} = this,
            cell = cells.find(it => it.id === id);
        if (!cell) return `There is no cell '${id}'.`;
        if (this.isLocked) return 'The layout is locked.';
        const {settings} = this,
            {columns, maxRows} = settings,
            next = {...cell, ...pick(place, 'x', 'y', 'w', 'h')},
            {x, y, w, h} = next;
        if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || x + w > columns) {
            return `'${id}' must lie on the grid, within its ${columns} columns.`;
        }
        if (w < (cell.minW ?? 1) || h < (cell.minH ?? 1)) {
            return `'${id}' is at least ${cell.minW ?? 1} by ${cell.minH ?? 1}.`;
        }
        if (y + h > maxRows) return `'${id}' must lie within the canvas's ${maxRows} rows.`;
        const placed = placeCell(cells, next, settings);
        if (!placed) {
            const over = cells.find(
                it =>
                    it.id !== id &&
                    x < it.x + it.w &&
                    it.x < x + w &&
                    y < it.y + it.h &&
                    it.y < y + h
            );
            return `'${id}' would overlap '${over?.id}'.`;
        }
        const changed = differenceWith(placed, cells, isEqual);
        if (!changed.length) {
            return `'${id}' stays where it is, as the canvas packs its cells ${settings.compact === 'horizontal' ? 'left' : 'up'}.`;
        }
        const refusal = this.canApplyUserEdit([
            {
                op: 'set',
                path: `/elements/${this.id}/children`,
                value: this.childrenWith(changed)
            }
        ]);
        if (refusal) return refusal;
        this.onCellsChange(changed, {kind: w !== cell.w || h !== cell.h ? 'resize' : 'move', id});
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
        const {settings} = model,
            // The hint lies over a live canvas, so an empty one still takes a drop.
            empty = emptyContent(model);
        return box({
            className,
            flex: 1,
            position: 'relative',
            children: [
                gridCanvas({
                    cells: model.cells,
                    editable: !model.isLocked,
                    showGrid: model.isDesign || settings.showGridBackground,
                    ...pick(settings, 'columns', 'rowHeight', 'compact', 'preventCollision'),
                    ...pick(settings, 'margin', 'containerPadding', 'maxRows'),
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
                    onChange: (cells, change) => model.onCellsChange(cells, change),
                    onDropOver: e => model.onDropOver(e),
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

// A cell's header: its icon, the element's own or else its widget's, and its title, then in design
// mode its element's id or toolbar, which gives way first, then its header items.
const cellHeader = hoistCmp.factory<HoistProps & {model: DashCanvasWidgetModel; id: string}>({
    displayName: 'DashCanvasCellHeader',
    model: false,
    render({model, id}) {
        const {blueprint, registry} = model.blueprintModel,
            element = blueprint?.elements?.[id],
            props = {className: `${CLS}__cell-icon`},
            title = model.titles[id];
        return hbox({
            className: `${CLS}__cell-header`,
            ...({'data-blueprint-view-header': true} as PlainObject),
            children: [
                element?.config?.icon
                    ? Icon.icon({faName: element.config.icon, ...props})
                    : widgetIcon(registry.widgets[element?.component], props),
                span({className: `${CLS}__cell-title`, children: title}),
                div({className: `${CLS}__cell-items`, children: model.headerItemsFor(id)})
            ]
        });
    }
});

interface CanvasSettings {
    columns: number;
    rowHeight: number;
    compact: GridCompact;
    preventCollision: boolean;
    margin: [number, number];
    containerPadding: [number, number];
    maxRows: number;
    showGridBackground: boolean;
    layoutLocked: boolean;
}
