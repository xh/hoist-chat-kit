import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import {
    dashCanvas,
    DashCanvasModel,
    type DashCanvasItemState,
    type DashCanvasViewSpec
} from '@xh/hoist/desktop/cmp/dash';
import {isEqual, pick, sortBy} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type DashCanvasWidgetConfig,
    type ChildRef
} from '../../../blueprint';
import {emptyContent} from './impl/layout';

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
            contentLocked: true,
            renameLocked: true,
            showAddViewButtonWhenEmpty: false
        });

        this.addReaction(
            {
                track: () => [this.children, this.titles],
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

    /** Each child's title, by ID, with bindings resolved. Null for a child with none. */
    get titles(): Record<string, string> {
        const {blueprintModel} = this,
            elements = blueprintModel.blueprint?.elements ?? {};
        return Object.fromEntries(
            this.children.map(({id}) => {
                const title = blueprintModel.resolve(elements[id]?.config?.title);
                return [id, title == null || title === '' ? null : String(title)];
            })
        );
    }

    //------------------
    // Implementation
    //------------------
    /**
     * Doc to model: specs for the current children, then their placement and titles. A view keeps
     * the spec it was created with, so a child that gains or loses its title, and with it its
     * header, gets a new view. The widget models live outside the canvas, so they survive that.
     */
    private loadChildren() {
        const {canvasModel, children, titles} = this,
            hasHeader = (id: string) => titles[id] != null,
            headerChanged = canvasModel.viewModels.some(
                it => !it.viewSpec.hidePanelHeader !== hasHeader(it.viewSpec.id)
            );
        if (headerChanged) canvasModel.clear();
        canvasModel.setViewSpecs(children.map(it => this.viewSpecFor(it.id, hasHeader(it.id))));

        const state = fromChildren(children, titles),
            titlesMatch = canvasModel.viewModels.every(
                it => titles[it.viewSpec.id] == null || it.title === titles[it.viewSpec.id]
            );
        if (titlesMatch && isEqual(toPlacement(canvasModel.state), toPlacement(state))) return;
        canvasModel.loadState(state);
    }

    /** Model to doc: a drag or resize becomes one edit, with children in reading order. */
    private writeChildren(state: DashCanvasItemState[]) {
        const {children} = this;
        if (state.length !== children.length) return;
        if (isEqual(toPlacement(state), toPlacement(fromChildren(children)))) return;
        const next = sortBy(
            state.map(it => ({id: it.viewSpecId, ...pick(it.layout, 'x', 'y', 'w', 'h')})),
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
        return emptyContent(model) ?? dashCanvas({model: model.canvasModel, className});
    }
});

//------------------
// Implementation
//------------------
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
