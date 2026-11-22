import {box, div, span} from '@xh/hoist/cmp/layout';
import {Icon} from '@xh/hoist/icon';
import {wait} from '@xh/hoist/promise';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import {
    dashCanvas,
    DashCanvasModel,
    type DashCanvasItemState,
    type DashCanvasViewModel,
    type DashCanvasViewSpec
} from '@xh/hoist/desktop/cmp/dash';
import {runInAction} from '@xh/hoist/mobx';
import {isEqual, pick, sortBy} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type DashCanvasWidgetConfig,
    type ChildRef
} from '../../../blueprint';
import {CANVAS_GAP, emptyContent} from './impl/layout';
import {paletteDrag} from './impl/paletteDrag';

/** The view a palette drag places on a canvas until the widget it carries is added. */
export const DROP_VIEW_ID = '$drop';

/**
 * The `dashCanvas` widget: a Hoist `DashCanvas` that places each child at the `x`, `y`, `w` and `h`
 * of its child reference. It places children as written, never compacting them. A drag or resize
 * becomes one edit of the children, in reading order.
 */
export class DashCanvasWidgetModel extends BlueprintWidgetModel<DashCanvasWidgetConfig> {
    @managed readonly canvasModel: DashCanvasModel;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        const {columns = 12, rowHeight = 50} = this.resolvedConfig;
        this.canvasModel = new DashCanvasModel({
            viewSpecs: [],
            columns,
            rowHeight,
            compact: false,
            margin: [CANVAS_GAP, CANVAS_GAP],
            containerPadding: [CANVAS_GAP, CANVAS_GAP],
            showGridBackground: this.isDesign,
            // Unlocked for palette drops only: every view spec still refuses add and remove.
            contentLocked: false,
            allowsDrop: true,
            onDropDragOver: () => this.onDragOver(),
            onDropDone: view => this.onDropDone(view),
            renameLocked: true,
            showAddViewButtonWhenEmpty: false
        });

        this.addReaction(
            {
                track: () => this.isDesign,
                run: isDesign => (this.canvasModel.showGridBackground = isDesign)
            },
            {
                track: () => [
                    this.children,
                    this.titles,
                    this.cellHeaderRefs,
                    this.takesDrop,
                    this.isDesign
                ],
                run: () => this.loadChildren(),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => [
                    this.resolvedConfig.columns ?? 12,
                    this.resolvedConfig.rowHeight ?? 50
                ],
                run: ([columns, rowHeight]) => {
                    this.canvasModel.columns = columns;
                    this.canvasModel.rowHeight = rowHeight;
                }
            },
            {
                track: () => this.canvasModel.state,
                run: state => this.writeChildren(state),
                equals: 'structural'
            }
        );
    }

    /** Note a cell drag starting, which Escape then cancels. */
    startDrag() {
        this.dragCancelled = false;
        window.addEventListener('keydown', this.onDragKey, true);
    }

    endDrag() {
        window.removeEventListener('keydown', this.onDragKey, true);
        // A cancelled drag that moved nothing brings back no layout, so forget it once its stop
        // has settled, or it would undo the next resize.
        if (this.dragCancelled) wait().then(() => (this.dragCancelled = false));
    }

    override destroy() {
        this.endDrag();
        super.destroy();
    }

    // True once Escape cancels the drag in progress, until its layout comes back.
    private dragCancelled = false;

    // Escape ends the drag, which then puts the cell back, and never reaches the design keys.
    private onDragKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        e.preventDefault();
        this.dragCancelled = true;
        document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
    };

    /** True if a child's cell draws a header, from its title or its header items. */
    cellHasHeader(id: string): boolean {
        return this.titles[id] != null || this.cellHeaderRefs[id]?.length > 0;
    }

    private get isDesign(): boolean {
        return this.blueprintModel.mode === 'design';
    }

    /** True while a palette drag is in progress and the blueprint is open for design. */
    get takesDrop(): boolean {
        const {mode, access} = this.blueprintModel;
        return !!paletteDrag.current && mode === 'design' && access === 'write';
    }

    /**
     * The size of the placeholder for a widget dragged from the palette, or false to refuse the
     * drop: outside design mode, or for any other drag.
     */
    onDragOver(): {w: number; h: number} | false {
        const drag = paletteDrag.current;
        if (!drag || !this.takesDrop) return false;
        if (!this.canvasModel.draggedInView) {
            this.canvasModel.setDraggedInView({
                viewSpecId: DROP_VIEW_ID,
                layout: {x: 0, y: 0, ...drag.size}
            });
        }
        return drag.size;
    }

    /** Swap the placeholder a drop made for the widget the palette drag carries, in one edit. */
    onDropDone(view: DashCanvasViewModel) {
        const {canvasModel} = this,
            place = (id: string, layout: PlainObject) => ({
                id,
                ...pick(layout, 'x', 'y', 'w', 'h')
            }),
            dropped = canvasModel.state.find(it => it.viewSpecId === DROP_VIEW_ID),
            siblings = canvasModel.state
                .filter(it => it.viewSpecId !== DROP_VIEW_ID)
                .map(it => place(it.viewSpecId, it.layout)),
            drag = paletteDrag.current;
        canvasModel.removeView(view.id);
        paletteDrag.end();
        if (drag && dropped) {
            const {id: _id, ...child} = place(DROP_VIEW_ID, dropped.layout);
            drag.drop(this.id, child, siblings);
        }
    }

    /**
     * Each child's title, by ID, with bindings and variables resolved. Null for a child with none.
     * The cell is the child's only frame, so it carries the child's title.
     */
    get titles(): Record<string, string> {
        const {blueprintModel} = this,
            elements = blueprintModel.blueprint?.elements ?? {};
        return Object.fromEntries(
            this.children.map(({id}) => {
                const title = blueprintModel.resolveTitle(elements[id]?.config?.title);
                return [id, title == null || title === '' ? null : String(title)];
            })
        );
    }

    /**
     * Each child's header items, by ID: the cell's own `headerItems`, then a panel child's, which
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

    //------------------
    // Implementation
    //------------------
    /**
     * Doc to model: specs for the current children, then their placement, titles and header items.
     * A view keeps the spec it was created with, so a child that gains or loses its header, from
     * its title or its header items, gets a new view. The widget models live outside the canvas,
     * so they survive that.
     */
    private loadChildren() {
        const {canvasModel, children, titles, cellHeaderRefs} = this,
            hasHeader = (id: string) => titles[id] != null || cellHeaderRefs[id]?.length > 0,
            headerChanged = canvasModel.viewModels.some(
                it => !it.viewSpec.hidePanelHeader !== hasHeader(it.viewSpec.id)
            );
        if (headerChanged) canvasModel.clear();
        // The drop's spec exists only during a drag, as an addable spec shows in the Add menus.
        canvasModel.setViewSpecs([
            ...children.map(it => this.viewSpecFor(it.id, hasHeader(it.id))),
            ...(this.takesDrop ? [DROP_VIEW_SPEC] : [])
        ]);
        if (!this.takesDrop) canvasModel.setDraggedInView(null);

        const state = fromChildren(children, titles),
            titlesMatch = canvasModel.viewModels.every(
                it => titles[it.viewSpec.id] == null || it.title === titles[it.viewSpec.id]
            );
        if (!titlesMatch || !isEqual(toPlacement(canvasModel.state), toPlacement(state))) {
            canvasModel.loadState(state);
        }
        const elements = this.blueprintModel.blueprint?.elements ?? {};
        runInAction(() =>
            canvasModel.viewModels.forEach(vm => {
                const id = vm.viewSpec.id,
                    icon = elements[id]?.config?.icon;
                vm.headerItems = [
                    // In design mode a cell's header names its element, after its title.
                    this.isDesign
                        ? (this.renderDesignChrome?.(id) ??
                          span({
                              key: '_id',
                              className: 'xh-blueprint-dash-canvas__cell-id',
                              children: id
                          }))
                        : null,
                    ...(cellHeaderRefs[id] ?? []).map(it => this.renderElement(it.id))
                ].filter(Boolean);
                vm.icon = icon ? Icon.icon({faName: icon}) : null;
            })
        );
    }

    /** Model to doc: a drag or resize becomes one edit, with children in reading order. */
    private writeChildren(state: DashCanvasItemState[]) {
        const {children} = this;
        // A drop in progress writes its siblings with the widget it adds.
        if (state.some(it => it.viewSpecId === DROP_VIEW_ID)) return;
        if (this.dragCancelled) {
            this.dragCancelled = false;
            this.loadChildren();
            return;
        }
        if (state.length !== children.length) return;
        if (isEqual(toPlacement(state), toPlacement(fromChildren(children)))) return;
        // A cell keeps its other keys, such as its header items.
        const next = sortBy(
            state.map(it => ({
                ...children.find(ref => ref.id === it.viewSpecId),
                id: it.viewSpecId,
                ...pick(it.layout, 'x', 'y', 'w', 'h')
            })),
            ['y', 'x']
        );
        const ok = this.applyUserEdit([
            {op: 'set', path: `/elements/${this.id}/children`, value: next}
        ]);
        if (!ok) this.loadChildren();
    }

    private viewSpecFor(id: string, hasHeader: boolean): DashCanvasViewSpec {
        const {blueprint, registry} = this.blueprintModel,
            spec = registry.widgets[blueprint.elements[id]?.component];
        return {
            id,
            content: () => this.renderElement(id),
            hidePanelHeader: !hasHeader,
            unique: true,
            allowAdd: false,
            allowRemove: false,
            allowRename: false,
            minWidth: spec?.size?.min?.w,
            minHeight: spec?.size?.min?.h
        };
    }
}

export const [DashCanvasWidget, dashCanvasWidget] = hoistCmp.withFactory({
    displayName: 'DashCanvasWidget',
    className: 'xh-blueprint-dash-canvas',
    model: uses(DashCanvasWidgetModel),
    render({model, className}) {
        // The hint lies over a live canvas, so an empty one still takes a drop.
        const empty = emptyContent(model);
        return box({
            className,
            flex: 1,
            position: 'relative',
            children: [
                dashCanvas({
                    model: model.canvasModel,
                    rglOptions: {
                        onDragStart: () => model.startDrag(),
                        onDragStop: () => model.endDrag()
                    }
                }),
                empty ? div({className: `${className}__empty`, children: empty}) : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
const DROP_VIEW_SPEC: DashCanvasViewSpec = {
    id: DROP_VIEW_ID,
    content: () => null,
    hidePanelHeader: true,
    unique: true,
    allowAdd: true,
    allowRemove: false,
    allowRename: false
};

function fromChildren(
    children: ChildRef[],
    titles: Record<string, string> = {}
): DashCanvasItemState[] {
    return children.map(it => ({
        viewSpecId: it.id,
        title: titles[it.id] ?? null,
        layout: pick(it, 'x', 'y', 'w', 'h') as DashCanvasItemState['layout']
    }));
}

/** Placement by ID, in a stable order, to compare a canvas with the blueprint. */
function toPlacement(state: DashCanvasItemState[]): PlainObject[] {
    return sortBy(
        state.map(it => ({id: it.viewSpecId, ...pick(it.layout, 'x', 'y', 'w', 'h')})),
        'id'
    );
}
