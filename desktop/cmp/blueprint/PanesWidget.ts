import {box} from '@xh/hoist/cmp/layout';
import {hoistCmp, type PlainObject, uses} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {isEqual, pick} from 'lodash';
import {BlueprintWidgetModel, type PanesWidgetConfig} from '../../../blueprint';
import {
    type DockChange,
    type DockItem,
    dockLayout,
    dockMoveRefusal,
    type DockTarget,
    insertView,
    moveView
} from '../layout';
import {emptyContent, resetLayoutButton} from './impl/layout';
import {containerAt} from './design/impl/dropTargets';
import {currentDropSource, elementDrag} from './design/impl/elementDrag';
import {paletteDrag} from './impl/paletteDrag';

/**
 * The `panes` widget: a dock layout of splits and tab stacks, with a view per child, laid
 * out as its `layout` says. A user's rearrangement writes the layout back, so it stays transient in
 * run mode. It keeps no persisted state of its own.
 */
export class PanesWidgetModel extends BlueprintWidgetModel<PanesWidgetConfig> {
    /** The views asked to show, such as to reveal a selection. */
    @observableRef accessor shown: string[] = [];

    /** The views no tab shows, as the layout reports them. */
    @observableRef accessor hiddenViews: string[] = [];

    /**
     * The layout as the config gives it, or one stack with a tab per child. A child the layout
     * leaves out joins its first stack. With no children, none, so the container draws only a
     * surface that takes its first view.
     */
    get layout(): DockItem[] {
        const {layout} = this.resolvedConfig,
            views = this.children.map(it => ({type: 'view' as const, id: it.id}));
        if (!views.length) return [];
        if (!layout) return [{type: 'stack', content: views}];
        const ret = toLayout(layout as PlainObject[]),
            placed = new Set(viewIds(ret)),
            missing = views.filter(it => !placed.has(it.id));
        if (missing.length) {
            const stack = firstStack(ret);
            if (stack) stack.content.push(...missing);
            else ret.push({type: 'stack', content: missing});
        }
        return ret;
    }

    /** Each view's tab title: its reference's title, else its child's, else its id. */
    get titles(): Record<string, string> {
        const {blueprintModel} = this,
            elements = blueprintModel.effective?.elements ?? {};
        return Object.fromEntries(
            this.children.map(ref => [
                ref.id,
                (ref.title != null ? blueprintModel.resolveTitle(ref.title as string) : null) ??
                    (blueprintModel.resolveTitle(elements[ref.id]?.config?.title) || ref.id)
            ])
        );
    }

    /** Bring a child's view to the front of its stack. */
    @action
    activateView(id: string) {
        this.shown = [id];
    }

    @action
    setHiddenViews(ids: string[]) {
        if (!isEqual(ids, this.hiddenViews)) this.hiddenViews = ids;
    }

    /**
     * Write a layout a user made back to the config, as one edit named for the change, or transient
     * in run mode.
     */
    noteLayout(layout: PlainObject[], change?: DockChange) {
        if (!layout?.length || isEqual(toLayout(layout), this.layout)) return;
        const description =
            change && (change.kind === 'move' ? `Move ${change.id}` : `Resize ${this.id}`);
        this.setConfig('/layout', layout, description);
    }

    /** True if a reader may not rearrange the views, as `layoutLocked` says. Design mode may. */
    get isLocked(): boolean {
        return !!this.configValue('layoutLocked') && this.blueprintModel.mode !== 'design';
    }

    /** Why moving a view to a target would be refused, or null if it would apply. */
    canMove(id: string, target: DockTarget): string {
        if (this.isLocked) return 'The layout is locked.';
        const refusal = dockMoveRefusal(this.layout, id, target);
        if (refusal) return refusal;
        const next = moveView(this.layout, id, target);
        return this.canApplyUserEdit([{op: 'set', path: this.layoutPath, value: next}]);
    }

    /**
     * Move a view to a target as a drop does, as one edit, or transient in run mode. Returns why it
     * was refused, or null. For tests and tools that drive docking without a pointer, such as
     * `XH.getModels('PanesWidgetModel')` from DevTools.
     */
    moveView(id: string, target: DockTarget): string {
        const refusal = this.canMove(id, target);
        if (refusal) return refusal;
        this.noteLayout(moveView(this.layout, id, target), {kind: 'move', id});
        this.activateView(id);
        return null;
    }

    /** The widget a palette drag carries, while this container may take it, or null. */
    externalDrag(): string {
        const {mode, access} = this.blueprintModel,
            source = currentDropSource();
        if (mode !== 'design' || access !== 'write' || !source) return null;
        return 'widget' in source ? source.widget : source.element;
    }

    /** True if a drag over a point is this container's: not over a container inside a view. */
    acceptsDragAt(e: DragEvent): boolean {
        const el = containerAt(e.target as Element, this.blueprintModel, currentDropSource());
        return el?.dataset.blueprintElement === this.id;
    }

    /**
     * Drop the drag as a new view at a target, with the layout, as one edit: a palette widget
     * added, or an element moved here.
     */
    onDropExternal(_key: string, target: DockTarget) {
        const moving = elementDrag.current;
        if (moving) {
            elementDrag.end();
            moving.designModel.dropAt(
                {element: moving.element},
                {container: this.id, layoutWith: id => insertView(this.layout, id, target)}
            );
            return;
        }
        const drag = paletteDrag.current;
        paletteDrag.end();
        drag?.add(this.id, {
            extraOps: id => [
                {op: 'set', path: this.layoutPath, value: insertView(this.layout, id, target)}
            ]
        });
    }

    /** True if a reader has rearranged the views, which {@link resetLayout} undoes. */
    get isRearranged(): boolean {
        return this.blueprintModel.hasTransientValues(this.layoutPath);
    }

    /** Drop a reader's rearrangement, back to the blueprint's layout. */
    resetLayout() {
        this.blueprintModel.clearTransientValues(this.layoutPath);
    }

    private get layoutPath(): string {
        return `/elements/${this.id}/config/layout`;
    }
}

export const [PanesWidget, panesWidget] = hoistCmp.withFactory({
    displayName: 'PanesWidget',
    className: 'xh-blueprint-panes',
    model: uses(PanesWidgetModel),
    render({model, className}) {
        return (
            emptyContent(model) ??
            box({
                className,
                flex: 1,
                position: 'relative',
                children: [
                    dockLayout({
                        layout: model.layout,
                        editable: !model.isLocked,
                        viewRenderer: id => model.renderElement(id),
                        viewTitle: id => model.titles[id],
                        onChange: (layout, change) => model.noteLayout(layout, change),
                        canMove: (id, target) => model.canMove(id, target),
                        externalDrag: () => model.externalDrag(),
                        acceptsDragAt: e => model.acceptsDragAt(e),
                        onDropExternal: (key, target) => model.onDropExternal(key, target),
                        active: model.shown,
                        onHiddenChange: ids => model.setHiddenViews(ids)
                    }),
                    resetLayoutButton({
                        omit: !model.isRearranged,
                        onClick: () => model.resetLayout()
                    })
                ]
            })
        );
    }
});

//------------------
// Implementation
//------------------
// The parts of a layout a blueprint keeps: its shape, sizes and views.
function toLayout(layout: PlainObject[]): DockItem[] {
    return (layout ?? []).map(it => ({
        ...(pick(it, 'type', 'id', 'width', 'height') as DockItem),
        ...(it.content ? {content: toLayout(it.content)} : {})
    }));
}

function viewIds(layout: DockItem[]): string[] {
    return layout.flatMap(it => (it.type === 'view' ? [it.id] : viewIds(it.content ?? [])));
}

function firstStack(layout: DockItem[]): DockItem {
    for (const it of layout) {
        if (it.type === 'stack') return it;
        const found = firstStack(it.content ?? []);
        if (found) return found;
    }
    return null;
}
