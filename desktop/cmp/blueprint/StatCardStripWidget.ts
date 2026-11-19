import {statCard, statCardStrip} from '@xh/hoist/cmp/statcard';
import {span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type Intent, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {Cube, View} from '@xh/hoist/data';
import {fmtNumber} from '@xh/hoist/format';
import {computed, observableRef} from '@xh/hoist/mobx';
import {castArray, isFinite, max, mean, min, sum, uniq} from 'lodash';
import type {ReactNode} from 'react';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type StatCardStripWidgetConfig
} from '../../../blueprint';
import {type FormatLike, formatValue, resolveFormat} from '../../../blueprint/impl/formats';
import {fieldDisplay} from '../../../blueprint/impl/renderers';
import type {FieldDef} from '../../../blueprint';

/** One card of a stat card strip, as it shows. */
export interface StatCardStripCard {
    key: string;
    title: ReactNode;
    value: ReactNode;
    /** The change, with an arrow in color, said in words to a screen reader. */
    subValue?: ReactNode;
    /** What the change compares against. */
    detail?: string;
    intent?: Intent;
}

/**
 * The `statCardStrip` widget: a Hoist `StatCardStrip` of headline numbers over its source. A card
 * with no `agg` shows the field's total as the Cube rolls it up. A card with an `agg` computes it
 * over the source's rows, and `count` with no field counts them.
 */
export class StatCardStripWidgetModel extends BlueprintWidgetModel<StatCardStripWidgetConfig> {
    @managed @observableRef accessor view: View = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        // Built now, not by fireImmediately, which MobX defers inside a batch such as a render.
        this.setCube(this.source?.cube);
        this.addReaction({track: () => this.source?.cube, run: cube => this.setCube(cube)});
    }

    private setCube(cube: Cube) {
        this.registerView(null);
        this.view?.destroy();
        this.view = cube
            ? cube.createView({query: {dimensions: [], includeRoot: true}, connect: true})
            : null;
        this.registerView(this.view);
    }

    @computed
    get cards(): StatCardStripCard[] {
        const {view, source, blueprintModel} = this;
        if (!view || !source) return [];
        const root: PlainObject = view.result.rows[0] ?? {},
            cards = castArray(this.resolvedConfig.cards ?? []),
            // Only a card with its own agg, or a count, scans the rows.
            rows = cards.some(it => it.agg || !it.field)
                ? source.cube.store.records.map(it => it.data)
                : [],
            {catalog, blueprint, registry} = blueprintModel;

        return cards.map((card, idx) => {
            const def = source.fields[card.field],
                key = `${idx}-${card.field ?? card.agg}`;
            if (!def) {
                return {
                    key,
                    title: card.label ?? 'Count',
                    value: fmtNumber(rows.length, {precision: 0})
                };
            }
            const rollUp = (name: string) =>
                    card.agg
                        ? aggregate(
                              rows.map(it => it[name]),
                              card.agg
                          )
                        : root[name],
                value = rollUp(def.name),
                display = fieldDisplay(def, {format: card.format}, {catalog, blueprint, registry}),
                deltaDef = source.fields[card.deltaField];
            return {
                key,
                title: card.label ?? source.fieldLabel(def.name),
                value:
                    card.agg === 'count'
                        ? fmtNumber(value as number, {precision: 0})
                        : display.render(value),
                subValue: deltaDef
                    ? this.formatDelta(
                          rollUp(deltaDef.name) as number,
                          deltaDef,
                          card.deltaFormat ?? card.format,
                          card.invert
                      )
                    : null,
                detail: card.deltaLabel ?? null,
                intent: card.intent && card.intent !== 'none' ? card.intent : null
            };
        });
    }

    /**
     * A change with an arrow in color - the reverse for a figure where up is bad - which a screen
     * reader hears in words, such as "up 1.2%", as the arrow alone does not say which way it moved.
     */
    private formatDelta(delta: number, def: FieldDef, format: unknown, invert: boolean): ReactNode {
        if (!isFinite(delta)) return null;
        const {catalog, blueprint} = this.blueprintModel,
            opts = resolveFormat(def, format ? [format as FormatLike] : [], {catalog, blueprint}),
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

export const [StatCardStripWidget, statCardStripWidget] = hoistCmp.withFactory({
    displayName: 'StatCardStripWidget',
    className: 'xh-blueprint-stat-cards',
    model: uses(StatCardStripWidgetModel),
    render({model, className}) {
        return statCardStrip({
            className,
            children: model.cards.map(({key, title, value, subValue, detail, intent}) =>
                statCard({key, title, value, subValue, detail, intent})
            )
        });
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
