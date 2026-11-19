import {describe, expect, it} from 'vitest';
import {DataCatalog, degradeAnswer} from '../../blueprint';
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
import {toWidgetName} from './specWidgets';

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
        expect(widgets.textInput).toMatchObject({
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
                config: spec.example
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

        it('translates into a statCardStrip over an inline source, card by card', () => {
            const bp = translate({cards});
            expect(bp.elements.kpis).toEqual({
                component: 'statCardStrip',
                config: {
                    source: 'kpis',
                    presentation: 'card',
                    cards: [
                        {field: 'v0'},
                        {field: 'v1', deltaField: 'd1'},
                        {field: 'v2', intent: 'success'},
                        {field: 'v3', deltaField: 'd3', deltaLabel: 'vs Q2', invert: true}
                    ]
                }
            });
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

        it('drops the last card while it streams, and stays the spec until a card is complete', () => {
            expect(translate({cards}, ['kpis']).elements.kpis.config.cards).toHaveLength(3);
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

        it('keeps a streaming grid every row, as its card drops the one still arriving', () => {
            expect(translate(props, ['g']).sources.g.inline.rows).toHaveLength(2);
        });

        it('leaves a grid by reference, and one that fails the catalog, as the spec', () => {
            expect(translate({data: 'art_1'}).elements.g.component).toBe('grid');
            expect(translate({columns: []}).elements.g.component).toBe('grid');
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
