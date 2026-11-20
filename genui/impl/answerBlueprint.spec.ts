import {omit} from 'lodash';
import {describe, expect, it} from 'vitest';
import {BlueprintRegistry, DataCatalog, degradeAnswer, validateBlueprint} from '../../blueprint';
import {
    chatUiBadgesSpec,
    chatUiCalloutSpec,
    chatUiCardSpec,
    chatUiChartSpec,
    chatUiGridSpec,
    chatUiInputSpecs,
    chatUiSectionSpec,
    chatUiSeparatorSpec,
    chatUiStackSpec,
    chatUiStatCardsSpec,
    chatUiTabsSpec,
    chatUiTextSpec,
    chatUiTreeMapSpec
} from '../../desktop/cmp/genui';
import {ChatUiCatalog} from '../ChatUiCatalog';
import {toAnswerBlueprint} from './answerBlueprint';
import {CHILD_REF_PROPS, toWidgetName} from './specWidgets';

/**
 * A document becomes an answer blueprint over the catalog's registry, where each catalog
 * component is a widget, so every answer renders and checks as a blueprint.
 */
describe('toAnswerBlueprint', () => {
    const components = [
            chatUiBadgesSpec(),
            chatUiCalloutSpec(),
            chatUiCardSpec(),
            chatUiChartSpec(),
            chatUiGridSpec(),
            chatUiSectionSpec(),
            chatUiSeparatorSpec(),
            chatUiStackSpec(),
            chatUiStatCardsSpec(),
            chatUiTabsSpec(),
            chatUiTextSpec(),
            chatUiTreeMapSpec(),
            ...chatUiInputSpecs()
        ],
        catalog = new ChatUiCatalog({components, modes: ['tools', 'document']}),
        ctx = {
            catalog: new DataCatalog({datasets: {}}),
            registry: catalog.registry,
            isAnswer: true,
            isComplete: true
        };

    it('registers each component as a widget, with its schema, category and size', () => {
        const {widgets} = catalog.registry;
        // A chat component a built-in shares its name with registers as its bridge.
        expect(widgets.chatUiTextInput).toMatchObject({
            category: 'input',
            value: {type: 'string'},
            config: chatUiInputSpecs().find(it => it.name === 'textInput').props
        });
        expect(widgets.stack).toMatchObject({category: 'container', children: {}});
        expect(widgets.text.size.default).toEqual({w: 12, h: 2});
        expect(widgets.chart.config.properties).toHaveProperty('source');
        expect(widgets.chatUiChart.label).toBe('Chart');
        expect(widgets.grid.label).toBe('Grid');
    });

    it("tells the Architect to keep tab titles short, after the tabs spec's own description", () => {
        const {tabs} = catalog.registry.widgets;
        expect(tabs.guidance.startsWith(chatUiTabsSpec().description)).toBe(true);
        expect(tabs.guidance).toMatch(/Keep tab titles to one or two words\./);
    });

    it('translates a component a built-in shares its name with into its bridged widget', () => {
        const bp = toAnswerBlueprint({
            root: 'c',
            elements: {c: {component: 'chart', props: chatUiChartSpec().example}}
        });
        expect(bp.elements.c.component).toBe('chatUiChart');
        expect(degradeAnswer(bp, ctx)).toEqual(bp);
    });

    it("registers chat kit's action types, in place of the built-ins of the same name", () => {
        const {actions} = catalog.registry;
        expect(actions.send.describe({text: 'Hi'})).toBe('Sends: "Hi"');
        expect(actions.openUrl.params.properties).toHaveProperty('label');
        expect(actions.setVariable).toBeTruthy();
    });

    it.each(components.filter(it => it.example).map(it => [it.name, it]))(
        "translates the example of '%s' into a valid answer",
        (name, spec) => {
            const bp = toAnswerBlueprint({
                root: 'root',
                elements: {root: {component: name as string, props: spec.example}}
            });
            expect(bp.elements.root).toEqual({
                component: toWidgetName(name as string),
                config: omit(spec.example, CHILD_REF_PROPS[name as string]?.prop ?? [])
            });
            expect(degradeAnswer(bp, ctx)).toEqual(bp);
        }
    );

    describe('stat cards', () => {
        const cards = [
                {label: 'Revenue', value: 1250000, format: 'currency', decimals: 0},
                {label: 'Margin', value: 0.184, format: 'percent', delta: 0.012},
                {label: 'Status', value: 'On track', intent: 'success'},
                {label: 'VaR', value: 9, delta: 2, deltaLabel: 'vs Q2', invert: true}
            ],
            translate = (props: object, partialIds: string[] = []) =>
                toAnswerBlueprint(
                    {root: 'kpis', elements: {kpis: {component: 'statCards', props}}} as any,
                    {
                        partialIds,
                        isValid: (name, props, isPartial) =>
                            catalog.validate(name, props, {isPartial}).length === 0
                    }
                );

        it('translates into a tileFrame of statCards over an inline source, card by card', () => {
            const bp = translate({cards});
            expect(bp.elements.kpis).toEqual({
                component: 'tileFrame',
                config: {},
                children: [1, 2, 3, 4].map(n => ({id: `kpis-card${n}`}))
            });
            expect([1, 2, 3, 4].map(n => bp.elements[`kpis-card${n}`])).toEqual([
                {component: 'statCard', config: {source: 'kpis', field: 'v0'}},
                {component: 'statCard', config: {source: 'kpis', field: 'v1', deltaField: 'd1'}},
                {component: 'statCard', config: {source: 'kpis', field: 'v2', intent: 'success'}},
                {
                    component: 'statCard',
                    config: {
                        source: 'kpis',
                        field: 'v3',
                        deltaField: 'd3',
                        deltaLabel: 'vs Q2',
                        invert: true
                    }
                }
            ]);
            const {fields, rows} = bp.sources.kpis.inline;
            expect(rows).toEqual([
                {v0: 1250000, v1: 0.184, d1: 0.012, v2: 'On track', v3: 9, d3: 2}
            ]);
            expect(fields.find(it => it.name === 'v0')).toMatchObject({
                label: 'Revenue',
                type: 'number',
                format: {prefix: '$', precision: 0, scale: 'auto'}
            });
            expect(fields.find(it => it.name === 'v1')).toMatchObject({kind: 'fraction'});
            expect(fields.find(it => it.name === 'v2')).toMatchObject({type: 'string'});
        });

        it('carries into a dashboard as it is, as a plain tileFrame takes no presentation', () => {
            const issues = validateBlueprint(translate({cards}), {
                catalog: new DataCatalog({datasets: {}}),
                registry: new BlueprintRegistry()
            });
            expect(issues.filter(it => it.severity === 'error')).toEqual([]);
        });

        it('drops the last card while it streams, and stays the spec until a card is complete', () => {
            expect(translate({cards}, ['kpis']).elements.kpis.children).toHaveLength(3);
            expect(translate({cards: cards.slice(0, 1)}, ['kpis']).elements.kpis.component).toBe(
                'statCards'
            );
        });

        it('stays the spec when its props fail the catalog, so its fallback reads as one', () => {
            expect(translate({cards: [{label: 'x'}]}).elements.kpis.component).toBe('statCards');
        });
    });

    describe('grids', () => {
        const props = {
                title: 'Positions',
                sortBy: 'pnl|desc',
                columns: [
                    {field: 'symbol', headerName: 'Symbol'},
                    {field: 'pnl', type: 'number', format: 'currency', decimals: 0},
                    {field: 'weight', type: 'number', format: 'percent'},
                    {field: 'asOf', type: 'date'},
                    {field: 'live', type: 'boolean'}
                ],
                rows: [
                    {symbol: 'AAPL', pnl: 1200, weight: 0.1, asOf: '2026-11-19', live: true},
                    {symbol: 'MSFT', pnl: -300, weight: 0.05, asOf: '2026-11-19', live: false}
                ]
            },
            translate = (p: object, partialIds: string[] = []) =>
                toAnswerBlueprint(
                    {root: 'g', elements: {g: {component: 'grid', props: p}}} as any,
                    {
                        partialIds,
                        isValid: (name, props, isPartial) =>
                            catalog.validate(name, props, {isPartial}).length === 0
                    }
                );

        it('translates an inline grid into a cubeGrid over an inline source', () => {
            const bp = translate(props);
            expect(bp.elements.g).toEqual({
                component: 'cubeGrid',
                config: {
                    source: 'g',
                    presentation: 'card',
                    title: 'Positions',
                    sortBy: 'pnl|desc',
                    columnState: ['symbol', 'pnl', 'weight', 'asOf', 'live']
                }
            });
            const {fields, rows} = bp.sources.g.inline;
            expect(rows).toEqual(props.rows);
            expect(fields).toEqual([
                {name: 'symbol', label: 'Symbol', type: 'string'},
                {name: 'pnl', type: 'number', format: {prefix: '$', precision: 0}},
                {name: 'weight', type: 'number', kind: 'fraction', format: {precision: 1}},
                {name: 'asOf', type: 'localDate'},
                {name: 'live', type: 'bool'}
            ]);
        });

        it("renames a column named id, which a source keeps for each row's key", () => {
            const bp = translate({
                columns: [{field: 'id', type: 'number'}, {field: 'id_'}],
                rows: [{id: 7, id_: 'a'}]
            });
            expect(bp.elements.g.config.columnState).toEqual(['id__', 'id_']);
            expect(bp.sources.g.inline.fields[0]).toMatchObject({name: 'id__', label: 'ID'});
            expect(bp.sources.g.inline.rows).toEqual([{id__: 7, id_: 'a'}]);
        });

        it('leaves out the row still arriving while a grid streams, as it may be cut short', () => {
            expect(translate(props, ['g']).sources.g.inline.rows).toEqual([props.rows[0]]);
        });

        it('leaves a grid by reference, and one that fails the catalog, as the spec', () => {
            expect(translate({data: 'art_1'}).elements.g.component).toBe('grid');
            expect(translate({columns: []}).elements.g.component).toBe('grid');
        });
    });

    describe('charts', () => {
        const translate = (props: object, partialIds: string[] = []) =>
            toAnswerBlueprint({root: 'c', elements: {c: {component: 'chart', props}}} as any, {
                partialIds,
                isValid: (name, props, isPartial) =>
                    catalog.validate(name, props, {isPartial}).length === 0
            });

        it('translates a category chart into a chart over an inline source, in category order', () => {
            const bp = translate({
                title: 'Monthly revenue',
                type: 'column',
                xAxis: {categories: ['Mar', 'Jan']},
                yAxis: {title: 'USD', format: 'currency', decimals: 0},
                series: [
                    {name: 'Revenue', data: [231000, 182000]},
                    {name: 'Cost', data: [90000]}
                ]
            });
            expect(bp.elements.c).toEqual({
                component: 'chart',
                config: {
                    source: 'c',
                    presentation: 'card',
                    type: 'column',
                    x: 'x',
                    y: ['s0', 's1'],
                    sortBy: 'xOrder|asc',
                    title: 'Monthly revenue',
                    xTitle: '',
                    yTitle: 'USD'
                }
            });
            const {fields, rows} = bp.sources.c.inline;
            expect(rows).toEqual([
                {x: 'Mar', xOrder: 0, s0: 231000, s1: 90000},
                {x: 'Jan', xOrder: 1, s0: 182000}
            ]);
            expect(fields).toEqual([
                {name: 'x', type: 'string', isDimension: true},
                {name: 'xOrder', type: 'number', aggregator: 'MIN'},
                {
                    name: 's0',
                    label: 'Revenue',
                    type: 'number',
                    aggregator: 'SUM',
                    format: {prefix: '$', precision: 0}
                },
                {
                    name: 's1',
                    label: 'Cost',
                    type: 'number',
                    aggregator: 'SUM',
                    format: {prefix: '$', precision: 0}
                }
            ]);
        });

        it('merges the points of a datetime chart by date, with no category order', () => {
            const bp = translate({
                type: 'line',
                xAxis: {type: 'datetime'},
                series: [
                    {
                        name: 'A',
                        data: [
                            ['2026-11-18', 1],
                            ['2026-11-19', 2]
                        ]
                    },
                    {name: 'B', data: [['2026-11-19', 3]]}
                ]
            });
            expect(bp.elements.c.config.sortBy).toBeUndefined();
            expect(bp.sources.c.inline.fields[0]).toEqual({name: 'x', type: 'localDate'});
            expect(bp.sources.c.inline.rows).toEqual([
                {x: '2026-11-18', xOrder: 0, s0: 1},
                {x: '2026-11-19', xOrder: 1, s0: 2, s1: 3}
            ]);
        });

        it('leaves out the point still arriving while a chart streams, such as a date cut short', () => {
            const bp = translate(
                {
                    type: 'line',
                    xAxis: {type: 'datetime'},
                    series: [
                        {name: 'A', data: [['2026-11-18', 1]]},
                        {
                            name: 'B',
                            data: [
                                ['2026-11-18', 2],
                                ['2026--0-7-', 3]
                            ]
                        }
                    ]
                },
                ['c']
            );
            expect(bp.sources.c.inline.rows).toEqual([{x: '2026-11-18', xOrder: 0, s0: 1, s1: 2}]);
        });

        it('takes the names of a pie from its pairs', () => {
            const bp = translate({
                type: 'pie',
                series: [
                    {
                        name: 'Share',
                        data: [
                            ['Equities', 60],
                            ['Bonds', 40]
                        ]
                    }
                ]
            });
            expect(bp.sources.c.inline.rows.map(it => it.x)).toEqual(['Equities', 'Bonds']);
        });

        it('leaves a chart by reference, and one that fails the catalog, as the spec', () => {
            expect(
                translate({data: 'art_1', type: 'line', x: 'd', y: ['v']}).elements.c.component
            ).toBe('chatUiChart');
            expect(translate({type: 'nope', series: []}).elements.c.component).toBe('chatUiChart');
        });
    });

    it('turns children and named slots into child references', () => {
        const bp = toAnswerBlueprint({
            root: 'top',
            elements: {
                top: {component: 'stack', props: {}, children: ['a'], slots: {default: ['b']}},
                a: {component: 'text', props: {text: 'First'}},
                b: {component: 'text', props: {text: 'Second'}}
            }
        });
        expect(bp.elements.top.children).toEqual([{id: 'a'}, {id: 'b'}]);
        expect(degradeAnswer(bp, ctx)).toEqual(bp);
    });

    it("moves each tab's title onto its child reference, as a tab container holds it", () => {
        const bp = toAnswerBlueprint({
            root: 'tabs',
            elements: {
                tabs: {component: 'tabs', props: {titles: ['Chart', 'Data']}, children: ['a', 'b']},
                a: {component: 'text', props: {text: 'First'}},
                b: {component: 'text', props: {text: 'Second'}}
            }
        });
        expect(bp.elements.tabs).toEqual({
            component: 'tabs',
            config: {},
            children: [
                {id: 'a', title: 'Chart'},
                {id: 'b', title: 'Data'}
            ]
        });
        expect(degradeAnswer(bp, ctx)).toEqual(bp);
    });

    it('leaves an element with problems for degradeAnswer to replace', () => {
        const bp = toAnswerBlueprint({
            root: 'top',
            elements: {
                top: {component: 'stack', props: {}, children: ['a', 'b']},
                a: {component: 'text', props: {text: 5}},
                b: {component: 'nope', props: {}}
            }
        } as any);
        const ret = degradeAnswer(bp, ctx);
        expect(ret.elements.top).toEqual(bp.elements.top);
        expect(ret.elements.a.component).toBe('fallback');
        expect(ret.elements.b.component).toBe('fallback');
    });
});
