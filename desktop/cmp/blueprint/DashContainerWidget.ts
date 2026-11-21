import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import {
    dashContainer,
    DashContainerModel,
    type DashContainerViewSpec,
    type DashContainerViewState
} from '@xh/hoist/desktop/cmp/dash';
import {isEqual, pick} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type DashContainerWidgetConfig
} from '../../../blueprint';
import {emptyContent} from './impl/layout';

/**
 * The `dashContainer` widget: a Hoist `DashContainer` with a view per child, laid out as its
 * `layout` says. A user's rearrangement writes the layout back, so it stays transient in run mode.
 * It keeps no persisted state of its own.
 */
export class DashContainerWidgetModel extends BlueprintWidgetModel<DashContainerWidgetConfig> {
    @managed readonly containerModel: DashContainerModel;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.containerModel = new DashContainerModel({
            viewSpecs: this.viewSpecs,
            initialState: this.layout as DashContainerViewState[],
            contentLocked: true,
            renameLocked: true,
            showMenuButton: false
        });
        this.addReaction(
            {
                track: () => this.viewSpecs.map(it => pick(it, 'id', 'title')),
                run: () => (this.containerModel.viewSpecs = this.viewSpecs),
                equals: 'structural'
            },
            {
                track: () => this.layout,
                run: layout => {
                    if (!isEqual(toLayout(this.containerModel.state), layout)) {
                        this.containerModel.loadStateAsync(layout as DashContainerViewState[]);
                    }
                },
                equals: 'structural'
            },
            {
                track: () => this.containerModel.state,
                run: state => this.noteLayout(toLayout(state)),
                equals: 'structural'
            }
        );
    }

    /** The layout as the config gives it, or one stack with a tab per child. */
    get layout(): PlainObject[] {
        const {layout} = this.resolvedConfig;
        return layout
            ? toLayout(layout as DashContainerViewState[])
            : [{type: 'stack', content: this.children.map(it => ({type: 'view', id: it.id}))}];
    }

    /** Write a layout a user made back to the config, as one edit, or transient in run mode. */
    noteLayout(layout: PlainObject[]) {
        if (!layout?.length || isEqual(layout, this.layout)) return;
        this.setConfig('/layout', layout);
    }

    //------------------
    // Implementation
    //------------------
    private get viewSpecs(): DashContainerViewSpec[] {
        const {blueprintModel} = this,
            elements = blueprintModel.effective?.elements ?? {};
        return this.children.map(ref => ({
            id: ref.id,
            title: plainTitle(
                (ref.title != null ? blueprintModel.resolveTitle(ref.title) : null) ??
                    (blueprintModel.resolveTitle(elements[ref.id]?.config?.title) || ref.id)
            ),
            content: () => this.renderElement(ref.id),
            unique: true,
            allowAdd: false,
            allowRemove: false,
            allowRename: false
        }));
    }
}

// GoldenLayout sets a tab's title as HTML, and Hoist resets it to text only after, so no title may
// hold a tag. Entities stay harmless, so P&L stays as written.
function plainTitle(title: string): string {
    return String(title ?? '')
        .replace(/</g, '‹')
        .replace(/>/g, '›');
}

// The parts of GoldenLayout's state a blueprint keeps: its shape, sizes and views.
function toLayout(state: DashContainerViewState[]): PlainObject[] {
    return (state ?? []).map(it => ({
        ...pick(it, 'type', 'id', 'width', 'height'),
        ...(it.content ? {content: toLayout(it.content)} : {})
    }));
}

export const [DashContainerWidget, dashContainerWidget] = hoistCmp.withFactory({
    displayName: 'DashContainerWidget',
    className: 'xh-blueprint-dash-container',
    model: uses(DashContainerWidgetModel),
    render({model, className}) {
        return emptyContent(model) ?? dashContainer({model: model.containerModel, className});
    }
});
