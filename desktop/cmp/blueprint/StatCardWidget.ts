import {fragment, span} from '@xh/hoist/cmp/layout';
import {sparkline} from '@xh/hoist/cmp/sparkline';
import {statCard} from '@xh/hoist/cmp/statcard';
import {hoistCmp, type Intent, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {Cube, View} from '@xh/hoist/data';
import {fmtNumber} from '@xh/hoist/format';
import {computed, observableRef} from '@xh/hoist/mobx';
import {isFinite, max, mean, min, sum, uniq} from 'lodash';
import type {ReactNode} from 'react';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type FieldDef,
    type StatCardWidgetConfig
} from '../../../blueprint';
import {type FormatLike, formatValue, resolveFormat} from '../../../blueprint/impl/formats';
import {fieldDisplay} from '../../../blueprint/impl/renderers';

/** A stat card, as it shows. */
export interface StatCardContent {
    title: ReactNode;
    value: ReactNode;
    /** The change, with an arrow in color, said in words to a screen reader. */
    subValue?: ReactNode;
    /** What the change compares against, and any trend. */
    detail?: ReactNode;
    intent?: Intent;
}

/**
 * The `statCard` widget: a Hoist `StatCard` of one headline number over its source. With no `agg`
 * it shows the field's total as the Cube rolls it up. With an `agg` it computes it over the
 * source's rows, and `count` with no field counts them.
 */
export class StatCardWidgetModel extends BlueprintWidgetModel<StatCardWidgetConfig> {
    @managed @observableRef accessor view: View = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        // Built now, not by fireImmediately, which MobX defers inside a batch such as a render.
        this.setCube(this.source?.cube);
        this.addReaction({track: () => this.source?.cube, run: cube => this.setCube(cube)});
    }

    @computed
    get card(): StatCardContent {
        const {view, source, blueprintModel} = this,
            config = this.resolvedConfig;
        if (!view || !source) return {title: config.label ?? null, value: null};
        const def = source.fields[config.field],
            root: PlainObject = view.result.rows[0] ?? {},
            // Only a card with its own agg, or a count, scans the rows.
            rows = config.agg || !def ? source.cube.store.records.map(it => it.data) : [],
            {catalog, blueprint, registry} = blueprintModel;

        if (!def) {
            return {
                title: config.label ?? 'Count',
                value: fmtNumber(rows.length, {precision: 0}),
                detail: this.withTrend(null)
            };
        }
        const rollUp = (name: string) =>
                config.agg
                    ? aggregate(
                          rows.map(it => it[name]),
                          config.agg
                      )
                    : root[name],
            value = rollUp(def.name),
            display = fieldDisplay(def, source.displayOf(def.name, {format: config.format}), {
                catalog,
                blueprint,
                registry
            }),
            deltaDef = source.fields[config.deltaField];
        return {
            title: config.label ?? source.fieldLabel(def.name),
            value:
                config.agg === 'count'
                    ? fmtNumber(value as number, {precision: 0})
                    : display.render(value),
            subValue: deltaDef
                ? this.formatDelta(
                      rollUp(deltaDef.name) as number,
                      deltaDef,
                      source.displayOf(deltaDef.name, {
                          format: config.deltaFormat ?? config.format
                      }).formats,
                      config.invert
                  )
                : null,
            detail: this.withTrend(config.deltaLabel ?? null),
            intent: config.intent && config.intent !== 'none' ? config.intent : null
        };
    }

    //------------------
    // Implementation
    //------------------
    // A series rolls up to nothing, so a trend draws from a source of one row only.
    private withTrend(detail: ReactNode): ReactNode {
        const {trend} = this.resolvedConfig,
            records = trend ? this.source?.cube.store.records : null,
            data = records?.length === 1 ? records[0].data[trend] : null;
        if (!Array.isArray(data)) return detail;
        return fragment(detail, sparkline({data, colorBy: 'trend', width: '100%'}));
    }

    private setCube(cube: Cube) {
        this.registerView(null);
        this.view?.destroy();
        this.view = cube
            ? cube.createView({query: {dimensions: [], includeRoot: true}, connect: true})
            : null;
        this.registerView(this.view);
    }

    /**
     * A change with an arrow in color - the reverse for a figure where up is bad - which a screen
     * reader hears in words, such as "up 1.2%", as the arrow alone does not say which way it moved.
     */
    private formatDelta(
        delta: number,
        def: FieldDef,
        formats: FormatLike[],
        invert: boolean
    ): ReactNode {
        if (!isFinite(delta)) return null;
        const {catalog, blueprint} = this.blueprintModel,
            opts = resolveFormat(def, formats, {catalog, blueprint}),
            shown = formatValue(
                delta,
                def,
                {...opts, withSignGlyph: true, colorSpec: invert ? INVERTED_COLORS : true},
                catalog
            ),
            size = formatValue(Math.abs(delta), def, opts, catalog, true),
            words = delta > 0 ? `up ${size}` : delta < 0 ? `down ${size}` : 'unchanged';
        return span({role: 'img', 'aria-label': words, children: shown});
    }
}

export const [StatCardWidget, statCardWidget] = hoistCmp.withFactory({
    displayName: 'StatCardWidget',
    className: 'xh-blueprint-stat-card',
    model: uses(StatCardWidgetModel),
    render({model, className}) {
        return statCard({className, flex: 1, ...model.card});
    }
});

//------------------
// Implementation
//------------------
const INVERTED_COLORS = {pos: 'xh-neg-val', neg: 'xh-pos-val', neutral: 'xh-neutral-val'};

function aggregate(values: unknown[], agg: string): unknown {
    const present = values.filter(it => it != null),
        nums = present as number[];
    switch (agg) {
        case 'count':
            return present.length;
        case 'SUM':
            return present.length ? sum(nums) : null;
        case 'AVG':
            return present.length ? mean(nums) : null;
        case 'MIN':
            return min(nums) ?? null;
        case 'MAX':
            return max(nums) ?? null;
        case 'UNIQUE': {
            const distinct = uniq(present);
            return distinct.length === 1 ? distinct[0] : null;
        }
        default:
            return null;
    }
}
