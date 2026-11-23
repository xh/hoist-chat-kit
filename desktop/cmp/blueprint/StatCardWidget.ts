import {box, span} from '@xh/hoist/cmp/layout';
import {sparkline} from '@xh/hoist/cmp/sparkline';
import {statCard} from '@xh/hoist/cmp/statcard';
import {hoistCmp, type Intent, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {Cube, View} from '@xh/hoist/data';
import {fmtNumber} from '@xh/hoist/format';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import {useOnResize} from '@xh/hoist/utils/react';
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
    /** The card's width in pixels, as it last drew, or null before it draws. */
    @observable accessor width: number = null;

    @action
    setWidth(width: number) {
        this.width = width;
    }

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
            // A narrow card steps a number to its compact form, such as 3.96b, before its text
            // shrinks, so its value never cuts short, unless its format names its own scale.
            own = source.displayOf(def.name, {format: config.format}),
            isCompact =
                this.width != null &&
                this.width < COMPACT_BELOW &&
                resolveFormat(def, own.formats, {catalog, blueprint}).scale == null,
            display = fieldDisplay(
                def,
                isCompact
                    ? source.displayOf(def.name, {format: config.format}, {format: {scale: 'auto'}})
                    : own,
                {catalog, blueprint, registry}
            ),
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
    // A trend draws its source's one row, or the root's sum where the series sums.
    private withTrend(detail: ReactNode): ReactNode {
        const {trend} = this.resolvedConfig,
            records = trend ? this.source?.cube.store.records : null,
            data =
                records?.length === 1
                    ? records[0].data[trend]
                    : (this.view?.result.rows[0] as PlainObject)?.[trend];
        if (!Array.isArray(data)) return detail;
        // As chat kit's stat cards draw it: the delta's label, then the trend in the rest of the
        // line, which the card's detail clips at its width.
        return span({
            className: 'xh-blueprint-stat-card__trend',
            children: [
                detail != null ? span({key: 'label', children: detail}) : null,
                sparkline({key: 'trend', data, colorBy: 'trend', flex: 1, minWidth: 0})
            ]
        });
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
        const ref = useOnResize(({width}) => model.setWidth(width));
        return box({ref, flex: 1, item: statCard({className, flex: 1, ...model.card})});
    }
});

//------------------
// Implementation
//------------------
const INVERTED_COLORS = {pos: 'xh-neg-val', neg: 'xh-pos-val', neutral: 'xh-neutral-val'};

// The width below which a card shows a number in its compact form.
const COMPACT_BELOW = 200;

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
