import {statCard, statCardStrip} from '@xh/hoist/cmp/statcard';
import {hoistCmp, managed, type PlainObject, uses} from '@xh/hoist/core';
import type {View} from '@xh/hoist/data';
import {fmtNumber} from '@xh/hoist/format';
import {computed, observableRef} from '@xh/hoist/mobx';
import {castArray, max, mean, min, sum, uniq} from 'lodash';
import type {ReactNode} from 'react';
import {BlueprintWidgetModel, type BlueprintWidgetConfig} from '../../../blueprint';
import {fieldDisplay} from '../../../blueprint/impl/renderers';

/** One card of a stat card strip, as it shows. */
export interface StatCardStripCard {
    key: string;
    title: ReactNode;
    value: ReactNode;
}

/**
 * The `statCardStrip` widget: a Hoist `StatCardStrip` of headline numbers over its source. A card
 * with no `agg` shows the field's total as the Cube rolls it up. A card with an `agg` computes it
 * over the source's rows, and `count` with no field counts them.
 */
export class StatCardStripWidgetModel extends BlueprintWidgetModel {
    @managed @observableRef accessor view: View = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction({
            track: () => this.source?.cube,
            run: cube => {
                this.registerView(null);
                this.view?.destroy();
                this.view = cube
                    ? cube.createView({query: {dimensions: [], includeRoot: true}, connect: true})
                    : null;
                this.registerView(this.view);
            },
            fireImmediately: true
        });
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
            const value = card.agg
                    ? aggregate(
                          rows.map(it => it[def.name]),
                          card.agg
                      )
                    : root[def.name],
                display = fieldDisplay(def, {format: card.format}, {catalog, blueprint, registry});
            return {
                key,
                title: card.label ?? source.fieldLabel(def.name),
                value:
                    card.agg === 'count'
                        ? fmtNumber(value as number, {precision: 0})
                        : display.render(value)
            };
        });
    }
}

export const [StatCardStripWidget, statCardStripWidget] = hoistCmp.withFactory({
    displayName: 'StatCardStripWidget',
    className: 'xh-blueprint-stat-cards',
    model: uses(StatCardStripWidgetModel),
    render({model, className}) {
        return statCardStrip({
            className,
            children: model.cards.map(({key, title, value}) => statCard({key, title, value}))
        });
    }
});

//------------------
// Implementation
//------------------
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
