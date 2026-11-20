import {propertyTable, type PropertyTableEntry} from '@xh/hoist/cmp/propertytable';
import {div, vbox} from '@xh/hoist/cmp/layout';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {Cube, View} from '@xh/hoist/data';
import {computed, observableRef} from '@xh/hoist/mobx';
import {castArray, isString} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type PropertyTableWidgetConfig
} from '../../../blueprint';
import {fieldDisplay} from '../../../blueprint/impl/renderers';

/**
 * The `propertyTable` widget: a Hoist `PropertyTable` of its fields over the rows its filter
 * leaves: their totals, or one row's own values where it leaves one.
 */
export class PropertyTableWidgetModel extends BlueprintWidgetModel<PropertyTableWidgetConfig> {
    @managed @observableRef accessor view: View = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.setCube(this.source?.cube);
        this.addReaction(
            {track: () => this.source?.cube, run: cube => this.setCube(cube)},
            {
                track: () => this.query,
                run: query => this.view?.updateQuery(query),
                equals: 'structural'
            }
        );
    }

    @computed
    get entries(): PropertyTableEntry[] {
        const {view, source, blueprintModel} = this;
        if (!view || !source) return [];
        const root: PlainObject = view.result.rows[0] ?? {},
            leaves = root.children ?? [],
            // One row shows its own values, as a field with no aggregator rolls up to nothing.
            values: PlainObject = leaves.length === 1 ? leaves[0] : root,
            {catalog, blueprint, registry} = blueprintModel;
        return castArray(this.resolvedConfig.fields ?? [])
            .map(it => (isString(it) ? {field: it} : it))
            .filter(it => source.fields[it.field])
            .map(({field, label, format, renderer}) => {
                const def = source.fields[field],
                    display = fieldDisplay(
                        def,
                        source.displayOf(field, {format, renderer} as any),
                        {catalog, blueprint, registry}
                    );
                return {
                    label: label ?? source.fieldLabel(field),
                    value: display.render(values[field] ?? null, values, leaves.length !== 1)
                };
            });
    }

    //------------------
    // Implementation
    //------------------
    private get query(): PlainObject {
        return {
            dimensions: [],
            filter: this.blueprintModel.resolveFilter(this.element?.config.filter),
            includeRoot: true,
            includeLeaves: true
        };
    }

    private setCube(cube: Cube) {
        this.registerView(null);
        this.view?.destroy();
        this.view = cube ? cube.createView({query: this.query as any, connect: true}) : null;
        this.registerView(this.view);
    }
}

export const [PropertyTableWidget, propertyTableWidget] = hoistCmp.withFactory({
    displayName: 'PropertyTableWidget',
    className: 'xh-blueprint-property-table',
    model: uses(PropertyTableWidgetModel),
    render({model, className}) {
        const {columns, labelSide, title} = model.resolvedConfig,
            table = propertyTable({entries: model.entries, columns, labelSide});
        // A canvas heads its cell with the title itself.
        return title && model.parentElement?.component !== 'dashCanvas'
            ? vbox({
                  className,
                  children: [
                      div({className: `${className}__title`, children: String(title)}),
                      table
                  ]
              })
            : vbox({className, children: table});
    }
});
