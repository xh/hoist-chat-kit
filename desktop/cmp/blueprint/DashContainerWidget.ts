import {hoistCmp, type PlainObject, uses} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {isEqual, pick} from 'lodash';
import {BlueprintWidgetModel, type DashContainerWidgetConfig} from '../../../blueprint';
import {type DockItem, dockLayout} from '../layout';
import {emptyContent} from './impl/layout';

/**
 * The `dashContainer` widget: a dock layout of splits and tab stacks, with a view per child, laid
 * out as its `layout` says. A user's rearrangement writes the layout back, so it stays transient in
 * run mode. It keeps no persisted state of its own.
 */
export class DashContainerWidgetModel extends BlueprintWidgetModel<DashContainerWidgetConfig> {
    /** The views asked to show, such as to reveal a selection. */
    @observableRef accessor shown: string[] = [];

    /** The views no tab shows, as the layout reports them. */
    @observableRef accessor hiddenViews: string[] = [];

    /**
     * The layout as the config gives it, or one stack with a tab per child. A child the layout
     * leaves out joins its first stack.
     */
    get layout(): DockItem[] {
        const {layout} = this.resolvedConfig,
            views = this.children.map(it => ({type: 'view' as const, id: it.id}));
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

    /** Write a layout a user made back to the config, as one edit, or transient in run mode. */
    noteLayout(layout: PlainObject[]) {
        if (!layout?.length || isEqual(toLayout(layout), this.layout)) return;
        this.setConfig('/layout', layout);
    }
}

export const [DashContainerWidget, dashContainerWidget] = hoistCmp.withFactory({
    displayName: 'DashContainerWidget',
    className: 'xh-blueprint-dash-container',
    model: uses(DashContainerWidgetModel),
    render({model, className}) {
        return (
            emptyContent(model) ??
            dockLayout({
                className,
                layout: model.layout,
                editable: true,
                renderView: id => model.renderElement(id),
                viewTitle: id => model.titles[id],
                onChange: layout => model.noteLayout(layout),
                active: model.shown,
                onHiddenChange: ids => model.setHiddenViews(ids)
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
