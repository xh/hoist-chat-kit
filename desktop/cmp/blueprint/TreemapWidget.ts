import {treeMap, TreeMapModel} from '@xh/hoist/cmp/treemap';
import {hoistCmp, type PlainObject, uses, XH} from '@xh/hoist/core';
import {Store, type StoreRecord, type View} from '@xh/hoist/data';
import {observableRef} from '@xh/hoist/mobx';
import {castArray, compact, isEqual} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type TreemapWidgetConfig
} from '../../../blueprint';

/**
 * The `treemap` widget: a Hoist `TreeMap` over its source grouped by `groupBy`, a node per group
 * sized by `value` and colored by `heat`. A click publishes the node's group path as its
 * `selection` output.
 */
export class TreemapWidgetModel extends BlueprintWidgetModel<TreemapWidgetConfig> {
    @observableRef accessor treeMapModel: TreeMapModel = null;
    @observableRef accessor store: Store = null;
    private view: View = null;
    private selection: PlainObject = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction(
            {
                track: () => [this.source?.cube, this.shape],
                run: () => this.build(),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => this.filter,
                run: filter => this.view?.updateQuery({...this.view.query, filter}),
                equals: 'structural'
            }
        );
    }

    /** Publish a node's group path as the `selection` output. Selecting it again clears it. */
    select(record: StoreRecord) {
        const clauses = [];
        for (let r = record; r; r = r.parent) {
            const {cubeDimension, cubeLabelValue} = r.data;
            clauses.unshift({field: cubeDimension, op: '=', value: cubeLabelValue});
        }
        const filter = clauses.length > 1 ? {op: 'AND', filters: clauses} : (clauses[0] ?? null);
        this.selection = isEqual(filter, this.selection) ? null : filter;
        this.setOutput('selection', this.selection);
    }

    override destroy() {
        this.clear();
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    // What a change to rebuilds the map for.
    private get shape(): PlainObject {
        const {groupBy, value, heat, colorMode, maxDepth} = this.resolvedConfig;
        return {groupBy: castArray(groupBy ?? []), value, heat, colorMode, maxDepth};
    }

    private get filter() {
        return this.blueprintModel.resolveFilter(this.element?.config.filter);
    }

    private build() {
        this.clear();
        const cube = this.source?.cube,
            {groupBy, value, heat, colorMode = 'linear', maxDepth} = this.shape;
        if (!cube || !value || !groupBy.length) return;
        const store = new Store({
            fields: [
                'cubeLabel',
                'cubeDimension',
                'cubeLabelValue',
                ...compact([value, heat]).map(name => ({name, type: 'number' as const}))
            ],
            loadTreeData: true
        });
        this.view = cube.createView({
            query: {dimensions: groupBy, filter: this.filter, includeRoot: false},
            stores: store,
            connect: true
        });
        this.registerView(this.view);
        this.store = store;
        this.treeMapModel = new TreeMapModel({
            store,
            labelField: 'cubeLabel',
            valueField: value,
            heatField: heat ?? value,
            colorMode,
            maxDepth,
            onClick: record => this.select(record)
        });
    }

    private clear() {
        this.registerView(null);
        XH.safeDestroy(this.treeMapModel, this.view, this.store);
        this.treeMapModel = null;
        this.view = null;
        this.store = null;
    }
}

export const [TreemapWidget, treemapWidget] = hoistCmp.withFactory({
    displayName: 'TreemapWidget',
    className: 'xh-blueprint-treemap',
    model: uses(TreemapWidgetModel),
    render({model, className}) {
        return model.treeMapModel ? treeMap({model: model.treeMapModel, className}) : null;
    }
});
