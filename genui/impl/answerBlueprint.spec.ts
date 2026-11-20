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
import {toAnswerBlueprint, upgradeBridges} from './answerBlueprint';
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

    it('holds a message to the chat while the chat is busy or blocked, as the chat card does', () => {
        const {send} = catalog.registry.actions,
            check = (chatModel: object) =>
                send.check({text: 'Hi'}, {
                    blueprintModel: {hostContext: {context: {chatModel}}}
                } as any);
        expect(check({isBusy: true})).toBe('The chat is busy.');
        expect(check({isBusy: false, sendBlockedReason: 'Sign in first.'})).toBe('Sign in first.');
        expect(check({isBusy: false, sendBlockedReason: null})).toBeNull();
    });

    const kitOptions = {
        isValid: (name: string, props: object, isPartial: boolean) =>
            catalog.validate(name, props as any, {isPartial}).length === 0,
        kitComponentOf: (name: string) => catalog.getComponent(name)?.kitComponent
    };

    it.each(
        components
            .filter(it => it.example && !catalog.registry.widgets[toWidgetName(it.name)].reserved)
            .map(it => [it.name, it])
    )("translates the example of '%s' into a valid answer", (name, spec) => {
        const bp = toAnswerBlueprint({
            root: 'root',
            elements: {root: {component: name as string, props: spec.example}}
        });
        expect(bp.elements.root).toEqual({
            component: toWidgetName(name as string),
            config: omit(spec.example, CHILD_REF_PROPS[name as string]?.prop ?? [])
        });
        expect(degradeAnswer(bp, ctx)).toEqual(bp);
    });

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

    describe('content and layout', () => {
        const translate = (elements: object, root = 'top', partialIds: string[] = []) =>
            toAnswerBlueprint({root, elements} as any, {
                partialIds,
                isValid: (name, props, isPartial) =>
                    catalog.validate(name, props, {isPartial}).length === 0
            });

        it('translates text, callout, section and stack into the dashboard widgets', () => {
            const bp = translate({
                top: {
                    component: 'stack',
                    props: {direction: 'row', gap: 'small'},
                    children: ['note', 'warn', 'sec']
                },
                note: {component: 'text', props: {text: 'Use {braces} freely'}},
                warn: {
                    component: 'callout',
                    props: {intent: 'warning', title: 'Heads {up}', text: 'Stale'}
                },
                sec: {
                    component: 'section',
                    props: {title: 'More', intent: 'primary', collapsible: true, collapsed: true},
                    children: ['inner']
                },
                inner: {component: 'text', props: {text: 'x'}}
            });
            expect(bp.elements.top).toEqual({
                component: 'box',
                config: {direction: 'row', gap: 4, fill: false},
                children: [{id: 'note'}, {id: 'warn'}, {id: 'sec'}]
            });
            expect(bp.elements.note).toEqual({
                component: 'markdown',
                config: {text: 'Use {{braces}} freely'}
            });
            expect(bp.elements.warn).toEqual({
                component: 'callout',
                config: {intent: 'warning', title: 'Heads {{up}}', text: 'Stale'}
            });
            expect(bp.elements.sec).toEqual({
                component: 'panel',
                config: {
                    style: 'card',
                    title: 'More',
                    intent: 'primary',
                    collapsible: true,
                    collapsed: true
                },
                children: [{id: 'inner'}]
            });
            expect(degradeAnswer(bp, ctx)).toEqual(bp);
        });

        it('frames a titled stack in a card panel around its box', () => {
            const bp = translate({
                top: {component: 'stack', props: {title: 'Both'}, children: ['a']},
                a: {component: 'text', props: {text: 'A'}}
            });
            expect(bp.elements.top).toEqual({
                component: 'panel',
                config: {style: 'card', title: 'Both'},
                children: [{id: 'top-box'}]
            });
            expect(bp.elements['top-box']).toEqual({
                component: 'box',
                config: {direction: 'column', gap: 8, fill: false},
                children: [{id: 'a'}]
            });
            expect(degradeAnswer(bp, ctx)).toEqual(bp);
        });

        it('translates text still streaming, as markdown that renders partial text', () => {
            const bp = translate({top: {component: 'text', props: {text: 'Half **wr'}}}, 'top', [
                'top'
            ]);
            expect(bp.elements.top.component).toBe('markdown');
            expect(degradeAnswer(bp, {...ctx, partialIds: ['top']})).toEqual(bp);
        });

        it("translates the kit's own components, whatever their names, and no others", () => {
            const doc = {
                    root: 'top',
                    elements: {
                        top: {component: 'column', props: {}, children: ['mine']},
                        mine: {component: 'stack', props: {}}
                    }
                } as any,
                bp = toAnswerBlueprint(doc, {
                    isValid: () => true,
                    kitComponentOf: name => (name === 'column' ? 'stack' : null)
                });
            expect(bp.elements.top.component).toBe('box');
            expect(bp.elements.mine.component).toBe('stack');
        });

        it('upgrades the bridges an answer saved before the translations holds', () => {
            const bp = upgradeBridges(
                {
                    root: 'top',
                    elements: {
                        top: {
                            component: 'stack',
                            config: {direction: 'row'},
                            children: [{id: 'a'}, {id: 'b'}]
                        },
                        a: {component: 'text', config: {text: 'Hi {there}'}},
                        b: {
                            component: 'chatUiCallout',
                            config: {intent: 'warning', text: 'Careful'}
                        }
                    }
                },
                kitOptions
            );
            expect(bp.elements.top).toEqual({
                component: 'box',
                config: {direction: 'row', gap: 8, fill: false},
                children: [{id: 'a'}, {id: 'b'}]
            });
            expect(bp.elements.a).toEqual({
                component: 'markdown',
                config: {text: 'Hi {{there}}'}
            });
            expect(bp.elements.b.component).toBe('callout');
            expect(degradeAnswer(bp, ctx)).toEqual(bp);
        });

        it('keeps a chat input on its bridge, as decision 135 has it', () => {
            const bp = translate({top: {component: 'textInput', props: {label: 'Name'}}});
            expect(bp.elements.top.component).toBe('chatUiTextInput');
        });

        it('translates a card into a card panel of its fields as properties, and its actions as buttons', () => {
            const bp = translate(
                {
                    c: {
                        component: 'card',
                        props: {
                            title: 'Acme',
                            subtitle: 'Tier {1}',
                            fields: [
                                {
                                    label: 'Exposure',
                                    value: 4200000,
                                    format: 'currency',
                                    decimals: 0
                                },
                                {label: 'Rating', value: 'A+'}
                            ],
                            actions: [
                                {
                                    type: 'send',
                                    label: 'Trades',
                                    text: 'Show trades.',
                                    confirm: {message: 'Sure?'}
                                }
                            ]
                        }
                    }
                },
                'c'
            );
            expect(bp.elements.c).toEqual({
                component: 'panel',
                config: {style: 'card', title: 'Acme'},
                children: [{id: 'c-subtitle'}, {id: 'c-fields'}, {id: 'c-actions'}]
            });
            expect(bp.elements['c-subtitle']).toEqual({
                component: 'markdown',
                config: {text: 'Tier {{1}}'}
            });
            expect(bp.elements['c-fields']).toEqual({
                component: 'propertyTable',
                config: {source: 'c', fields: ['v0', 'v1']}
            });
            expect(bp.elements['c-actions']).toEqual({
                component: 'buttonGroup',
                config: {
                    buttons: [
                        {
                            label: 'Trades',
                            action: {type: 'send', text: 'Show trades.', confirm: true}
                        }
                    ]
                }
            });
            expect(bp.sources.c.inline.rows).toEqual([{v0: 4200000, v1: 'A+'}]);
            expect(bp.sources.c.inline.fields[0]).toMatchObject({
                label: 'Exposure',
                type: 'number'
            });
            expect(degradeAnswer(bp, ctx)).toEqual(bp);
        });

        it('shows no actions on a card until it is complete, as the chat card does', () => {
            const card = {
                    component: 'card',
                    props: {
                        title: 'Acme',
                        fields: [
                            {label: 'Rating', value: 'A+'},
                            {label: 'Tier', value: '1'}
                        ],
                        actions: [
                            {type: 'send', label: 'Trades', text: 'Show trades.'},
                            {type: 'send', label: 'Orders', text: 'Show orders.'}
                        ]
                    }
                },
                streaming = translate({c: card}, 'c', ['c']);
            expect(streaming.elements['c-actions']).toBeUndefined();
            expect(translate({c: card}, 'c').elements['c-actions']).toBeTruthy();
        });
    });

    it.each(
        components
            .filter(it => it.example && catalog.registry.widgets[toWidgetName(it.name)].reserved)
            .map(it => [it.name, it])
    )("translates the example of '%s' into a dashboard widget, never its bridge", (name, spec) => {
        const bp = toAnswerBlueprint(
            {root: 'root', elements: {root: {component: name as string, props: spec.example}}},
            kitOptions
        );
        expect(bp.elements.root.component).not.toBe(toWidgetName(name as string));
        expect(degradeAnswer(bp, ctx)).toEqual(bp);
    });

    it('turns children and named slots into child references', () => {
        const bp = toAnswerBlueprint(
            {
                root: 'top',
                elements: {
                    top: {component: 'stack', props: {}, children: ['a'], slots: {default: ['b']}},
                    a: {component: 'text', props: {text: 'First'}},
                    b: {component: 'text', props: {text: 'Second'}}
                }
            },
            kitOptions
        );
        expect(bp.elements.top.children).toEqual([{id: 'a'}, {id: 'b'}]);
        expect(degradeAnswer(bp, ctx)).toEqual(bp);
    });

    it("moves each tab's title onto its child reference, as a tab container holds it", () => {
        const bp = toAnswerBlueprint({
            root: 'tabs',
            elements: {
                tabs: {component: 'tabs', props: {titles: ['Chart', 'Data']}, children: ['a', 'b']},
                a: {component: 'separator', props: {}},
                b: {component: 'separator', props: {}}
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
        const bp = toAnswerBlueprint(
            {
                root: 'top',
                elements: {
                    top: {component: 'stack', props: {}, children: ['a', 'b']},
                    a: {component: 'text', props: {text: 5}},
                    b: {component: 'nope', props: {}}
                }
            } as any,
            kitOptions
        );
        const ret = degradeAnswer(bp, ctx);
        expect(ret.elements.top).toEqual(bp.elements.top);
        expect(ret.elements.a.component).toBe('fallback');
        expect(ret.elements.b.component).toBe('fallback');
    });
});
