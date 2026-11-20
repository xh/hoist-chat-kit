import type {PlainObject} from '@xh/hoist/core';
import {describe, expect, it} from 'vitest';
import {
    ARTIFACTS,
    catalogFor,
    loadBlueprint,
    portfolioCatalog,
    scenarioFiles,
    scenarioRegistry
} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import {applyOps} from './applyOps';
import {BlueprintRegistry} from './BlueprintRegistry';
import {validateBlueprint} from './validateBlueprint';

/**
 * The validator is the only gate between what an LLM or a person writes and what renders. It must
 * pass every hand-written scenario, and refuse each mistake with a stable code and a path.
 */
describe('validateBlueprint', () => {
    const registry = scenarioRegistry(),
        validate = (bp: Blueprint, isAnswer = false) =>
            validateBlueprint(bp, {
                catalog: portfolioCatalog,
                registry,
                artifacts: ARTIFACTS,
                isAnswer
            }),
        codes = (bp: Blueprint) => validate(bp).map(it => it.code),
        p2 = () => loadBlueprint('p2-linked-dashboard.json');

    it.each(scenarioFiles().filter(f => loadBlueprint(f).elements))(
        'passes the scenario blueprint %s',
        file => {
            const issues = validateBlueprint(loadBlueprint(file), {
                catalog: catalogFor(file),
                registry,
                artifacts: ARTIFACTS,
                isAnswer: /answer|segment/.test(file)
            });
            expect(issues).toEqual([]);
        }
    );

    it('keeps P2 valid after the P4 edit', () => {
        const {result, issue} = applyOps(p2(), loadBlueprint('p4-edit.json')['ops']);
        expect(issue).toBeUndefined();
        expect(validate(result)).toEqual([]);
    });

    it('catches a broken copy of P3', () => {
        const bp = loadBlueprint('p3-morning-report.json');
        bp.elements.ordersGrid.config.columnState.push('bogus');
        bp.elements.posGrid.config.groupBy = ['mktVal'];
        (bp.variables.selection.setBy as any).output = 'nope';
        bp.elements.tabs.children.push({id: 'ghost', title: 'Ghost'});
        expect(codes(bp)).toEqual(
            expect.arrayContaining([
                'field.unknown',
                'field.notDimension',
                'variable.unknownOutput',
                'structure.unknownChild'
            ])
        );
    });

    it('reports each issue at a JSON Pointer into the blueprint', () => {
        const bp = p2();
        bp.elements.posGrid.config.columnState = ['mktVal', 'bogus'];
        expect(validate(bp)).toEqual([
            {
                code: 'field.unknown',
                severity: 'error',
                path: '/elements/posGrid/config/columnState/1',
                message: "'bogus' is not a field of source 'positions'"
            }
        ]);
    });

    it("refuses an inline value that its field's type cannot hold", () => {
        const bp = p2();
        bp.sources.stats = {
            inline: {
                fields: [
                    {name: 'day', type: 'localDate'},
                    {name: 'qty', type: 'number'},
                    {name: 'live', type: 'bool'}
                ],
                rows: [
                    {day: '2026-11-19', qty: 1, live: true},
                    {day: '2026--0-7-', qty: 'x', live: 'yes'},
                    {day: null, qty: null}
                ]
            }
        } as any;
        expect(
            validate(bp, true)
                .filter(it => it.code === 'source.badValue')
                .map(it => it.path)
        ).toEqual([
            '/sources/stats/inline/rows/1/day',
            '/sources/stats/inline/rows/1/qty',
            '/sources/stats/inline/rows/1/live'
        ]);
    });

    it("takes a grid's column config by field, and keeps columnState to state", () => {
        const bp = p2();
        bp.elements.posGrid.config.columns = {
            mktVal: {headerName: 'MV', align: 'center', flex: 1, format: {precision: 0}},
            group: {headerName: 'Book'}
        };
        expect(validate(bp)).toEqual([]);

        bp.elements.posGrid.config.columns.nope = {headerName: 'Nope'};
        expect(codes(bp)).toContain('field.unknown');

        const stated = p2();
        stated.elements.posGrid.config.columnState = [{field: 'mktVal', format: {precision: 0}}];
        expect(validate(stated).map(it => [it.code, it.path])).toEqual([
            ['schema.invalid', '/elements/posGrid/config/columnState/0/format']
        ]);
    });

    it("takes a grid's Hoist style options, and refuses a value Hoist does not have", () => {
        const bp = p2();
        Object.assign(bp.elements.posGrid.config, {
            treeStyle: 'highlightsAndBorders',
            stripeRows: true,
            rowBorders: true,
            cellBorders: false,
            showHover: true,
            sizingMode: 'large',
            showGroupRowCounts: false,
            hideHeaders: false,
            emptyText: 'No positions',
            groupRowHeight: 36
        });
        expect(validate(bp)).toEqual([]);

        Object.assign(bp.elements.posGrid.config, {treeStyle: 'stripes', sizingMode: 'huge'});
        expect(validate(bp).map(it => it.path)).toEqual(
            expect.arrayContaining([
                '/elements/posGrid/config/treeStyle',
                '/elements/posGrid/config/sizingMode'
            ])
        );
    });

    it("refuses an inline field named id, which a source keeps for each row's key", () => {
        const bp = p2();
        bp.sources.stats = {inline: {fields: [{name: 'id', type: 'number'}], rows: []}} as any;
        expect(validate(bp, true).map(it => it.code)).toContain('source.reservedField');
    });

    it('refuses an artifact outside a chat answer, and warns of inline rows there', () => {
        const bp = p2();
        bp.sources.fromChat = {artifact: 'art_7f2'};
        bp.sources.computed = {inline: {fields: [{name: 'v', type: 'number'}], rows: [{v: 1}]}};
        const issues = (isAnswer: boolean) =>
            validate(bp, isAnswer).map(it => `${it.severity} ${it.code}`);
        expect(issues(false)).toEqual(
            expect.arrayContaining([
                'error source.artifactOutsideAnswer',
                'warning source.inlineOutsideAnswer'
            ])
        );
        expect(issues(true)).toEqual([]);
    });

    it('refuses more inline rows outside a chat answer than a person would write by hand', () => {
        const bp = p2(),
            rows = (n: number) => Array.from({length: n}, (_, v) => ({v}));
        bp.sources.computed = {inline: {fields: [{name: 'v', type: 'number'}], rows: rows(51)}};
        expect(codes(bp)).toContain('source.tooManyInlineRows');
        expect(validate(bp, true).map(it => it.code)).not.toContain('source.tooManyInlineRows');
        bp.sources.computed.inline.rows = rows(50);
        expect(codes(bp)).not.toContain('source.tooManyInlineRows');
    });

    describe('elements still streaming', () => {
        const noteRegistry = new BlueprintRegistry({
                widgets: [
                    {
                        name: 'acme.note',
                        version: 1,
                        label: 'Note',
                        guidance: 'A note.',
                        category: 'data',
                        rendersPartial: true,
                        config: {
                            type: 'object',
                            required: ['text'],
                            additionalProperties: false,
                            properties: {
                                text: {type: 'string', minLength: 3},
                                action: {type: 'object', 'x-action': true}
                            }
                        },
                        validate: () => [
                            {code: 'note.never', severity: 'error', path: '', message: 'never'}
                        ]
                    }
                ]
            }),
            note = (config: object): Blueprint => ({
                root: 'n',
                elements: {n: {component: 'acme.note', config}}
            }),
            check = (bp: Blueprint, partialIds?: string[]) =>
                validateBlueprint(bp, {
                    catalog: portfolioCatalog,
                    registry: noteRegistry,
                    isAnswer: true,
                    partialIds
                }).map(it => it.code);

        it('checks a widget that renders partial configs only for what a growing value cannot fix', () => {
            expect(check(note({text: 'h'}), ['n'])).toEqual([]);
            expect(check(note({}), ['n'])).toEqual([]);
            expect(check(note({text: 5}), ['n'])).toEqual(['schema.invalid']);
            expect(check(note({text: 'h'}))).toEqual(['schema.invalid', 'note.never']);
        });

        it('still applies annotations and the forbidden-key walk to a partial element', () => {
            expect(check(note({action: 'go'}), ['n'])).toEqual(['schema.invalid']);
            const forbidden = JSON.parse('{"text": "hi", "__proto__": {}}');
            expect(check(note(forbidden), ['n'])).toEqual(['path.forbidden']);
        });

        it('checks a widget that does not render partial configs in full, even while streaming', () => {
            const bp = p2();
            bp.elements.posGrid.config.groupBy = 'sec';
            expect(
                validateBlueprint(bp, {
                    catalog: portfolioCatalog,
                    registry,
                    partialIds: ['posGrid']
                }).map(it => it.code)
            ).toContain('field.unknown');
        });
    });

    describe('widget config', () => {
        it('refuses a config that fails its schema, at the value at fault', () => {
            const bp = p2();
            bp.elements.sectorChart.config.type = 'donut';
            bp.elements.posGrid.config.colour = 'red';
            const issues = validate(bp);
            expect(issues.map(it => [it.code, it.path])).toEqual([
                ['schema.invalid', '/elements/posGrid/config/colour'],
                ['schema.invalid', '/elements/sectorChart/config/type']
            ]);
        });

        it('accepts a binding where the schema marks x-binding', () => {
            const bp = p2();
            bp.variables.title = {type: 'string', default: {value: 'Positions'}};
            bp.elements.posGrid.config.title = {$var: 'title'};
            expect(validate(bp)).toEqual([]);
        });

        it('refuses a binding where the schema does not mark x-binding', () => {
            const bp = p2();
            bp.elements.posGrid.config.groupRowHeight = {$var: 'asOf'};
            expect(codes(bp)).toEqual(['schema.invalid']);
        });

        it('checks a filter in code, with bindings at any level', () => {
            const bp = p2();
            bp.elements.ordersGrid.config.filter = {
                filters: [
                    {$var: 'selection'},
                    {field: 'dir', op: '=', value: ['Buy']},
                    {filters: [{field: 'mktVal', op: '>', value: 0}], op: 'OR'}
                ]
            };
            expect(validate(bp)).toEqual([]);

            bp.elements.ordersGrid.config.filter = {
                filters: [{field: 'dir', op: 'equals', value: 'Buy'}]
            };
            expect(validate(bp).map(it => it.path)).toEqual([
                '/elements/ordersGrid/config/filter/filters/0/op'
            ]);
        });

        it('accepts Hoist sort forms, and the tree column as group', () => {
            const bp = p2();
            bp.elements.posGrid.config.sortBy = ['pnlDay|desc|abs', 'group'];
            bp.elements.posGrid.config.columnState = [{field: 'group', pinned: 'left'}, 'mktVal'];
            expect(validate(bp)).toEqual([]);

            bp.elements.posGrid.config.sortBy = ['pnlDay|desc', 'bogus'];
            expect(validate(bp).map(it => it.path)).toEqual(['/elements/posGrid/config/sortBy/1']);
        });
    });

    describe('references to names that objects inherit', () => {
        it('finds no root named after an inherited member', () => {
            expect(codes({root: 'toString', elements: {}})).toContain('structure.unknownRoot');
        });

        it('finds no source named after an inherited member', () => {
            const bp = p2();
            bp.elements.posGrid.config.source = 'toString';
            expect(validate(bp)).toContainEqual(
                expect.objectContaining({
                    code: 'source.unknown',
                    path: '/elements/posGrid/config/source'
                })
            );
        });

        it('finds no variable named after an inherited member, as a filter or a value', () => {
            const bp = p2();
            bp.elements.posGrid.config.filter = {$var: 'constructor'};
            expect(codes(bp)).toContain('variable.unknown');

            bp.elements.posGrid.config.filter = {
                field: 'sector',
                op: '=',
                value: {$var: 'valueOf'}
            };
            expect(codes(bp)).toContain('variable.unknown');
        });

        it("checks a field instance's params: each known, bound to a variable, or of its type", () => {
            const bp = loadBlueprint('p3-morning-report.json'),
                codes = (params: object) => {
                    bp.sources.positions.fields = {r: {field: 'return', params}};
                    return validate(bp).map(it => it.code);
                };
            expect(codes({start: {$var: 'yearStart'}, end: '2026-11-20'})).toEqual([]);
            expect(codes({start: '', end: {$var: 'asOf'}})).toEqual(['source.badParam']);
            expect(codes({start: {$var: 'nope'}, end: {$var: 'asOf'}})).toEqual([
                'variable.unknown'
            ]);
            expect(codes({end: {$var: 'asOf'}})).toEqual(['source.missingParam']);
            expect(codes({start: {$var: 'asOf'}, end: {$var: 'asOf'}, x: 1})).toEqual([
                'source.unknownParam'
            ]);
        });

        it("lets presets control a variable's default, once it leaves the declaration", () => {
            const bp = loadBlueprint('p3-morning-report.json'),
                codes = () => validate(bp).map(it => it.code);
            bp.variables.symbol = {type: 'string', setBy: 'prompt'};
            bp.presets.tickers = {
                controls: [{path: '/variables/symbol/default'}],
                items: {apple: {set: {variables: {symbol: {default: {value: 'AAPL'}}}}}}
            };
            expect(codes()).toEqual([]);

            bp.variables.symbol.default = {value: 'IBM'};
            expect(codes()).toEqual(['preset.stillInConfig']);
            delete bp.variables.symbol.default;
            bp.presets.tickers.controls = [{path: '/variables/nope/default'}];
            expect(codes()).toContain('preset.badPath');
            bp.presets.tickers.controls = [{path: '/variables/symbol/label'}];
            expect(codes()).toContain('preset.badPath');
        });

        it('finds no child, widget, dataset or preset named after an inherited member', () => {
            const bp = p2();
            bp.elements.dashboard.children.push({id: 'hasOwnProperty'} as any);
            bp.elements.posGrid.component = 'toString';
            bp.sources.positions.dataset = 'valueOf';
            bp.presets = {
                views: {controls: [], items: {a: {set: {}}}, default: 'toString'}
            } as any;
            expect(codes(bp)).toEqual(
                expect.arrayContaining([
                    'structure.unknownChild',
                    'element.unknownComponent',
                    'source.unknownDataset',
                    'preset.unknownDefault'
                ])
            );
        });
    });

    it('refuses a key named __proto__, prototype or constructor anywhere', () => {
        const bp = JSON.parse(
            JSON.stringify(p2()).replace(
                '"variables":{',
                '"variables":{"__proto__":{"type":"string"},'
            )
        );
        expect(validate(bp)).toMatchObject([
            {code: 'path.forbidden', path: '/variables/__proto__'}
        ]);
        expect(({} as any).type).toBeUndefined();
    });

    describe('actions', () => {
        const withButtons = (action: unknown) => {
            const bp = loadBlueprint('p3-morning-report.json');
            bp.elements.pnlButtons.config.buttons = [{label: 'Go', action}];
            return bp;
        };
        const winners = {
            type: 'setVariable',
            variable: 'pnlFilter',
            value: {field: 'pnlDay', op: '>', value: 0}
        };

        it('takes one action, or a list of up to 8 steps, checking each step', () => {
            expect(validate(withButtons(winners))).toEqual([]);
            expect(
                validate(withButtons([winners, {type: 'resetVariable', variable: 'pnlFilter'}]))
            ).toEqual([]);
            expect(
                validate(
                    withButtons([
                        winners,
                        {type: 'setVariable', variable: 'selection', value: null}
                    ])
                )
            ).toMatchObject([
                {
                    code: 'action.cannotSet',
                    path: '/elements/pnlButtons/config/buttons/0/action/1/variable'
                }
            ]);
            expect(validate(withButtons(Array(9).fill(winners))).map(it => it.code)).toEqual([
                'schema.invalid'
            ]);
        });

        it('refuses an action type where its allowedIn does not reach, whatever registry holds it', () => {
            const reg = scenarioRegistry();
            reg.addActions({name: 'acme.send', params: {type: 'object'}, allowedIn: ['answers']});
            const bp = loadBlueprint('p3-morning-report.json');
            bp.elements.pnlButtons.config.buttons[0].action = {type: 'acme.send'};
            const check = (isAnswer: boolean) =>
                validateBlueprint(bp, {
                    catalog: portfolioCatalog,
                    registry: reg,
                    artifacts: ARTIFACTS,
                    isAnswer
                }).filter(it => it.code === 'action.notAllowedHere');
            expect(check(false)).toMatchObject([
                {path: '/elements/pnlButtons/config/buttons/0/action/type'}
            ]);
            expect(check(true)).toEqual([]);
        });

        it('checks a param marked x-variable as the name of a variable an action may set', () => {
            const reg = scenarioRegistry();
            reg.addActions({
                name: 'acme.pick',
                params: {
                    type: 'object',
                    required: ['target'],
                    properties: {target: {type: 'string', 'x-variable': true}}
                }
            });
            const codes = (target: unknown) => {
                const bp = loadBlueprint('p3-morning-report.json');
                bp.elements.pnlButtons.config.buttons[0].action = {type: 'acme.pick', target};
                return validateBlueprint(bp, {
                    catalog: portfolioCatalog,
                    registry: reg,
                    artifacts: ARTIFACTS
                }).map(it => it.code);
            };
            expect(codes('pnlFilter')).toEqual([]);
            expect(codes('nope')).toContain('variable.unknown');
            expect(codes('selection')).toContain('action.cannotSet');
            expect(codes({$var: 'pnlFilter'})).toContain('variable.unknown');
        });

        it('refuses an action with side effects in a chat answer', () => {
            const bp = loadBlueprint('p3-morning-report.json'),
                issues = validateBlueprint(bp, {
                    catalog: portfolioCatalog,
                    registry,
                    artifacts: ARTIFACTS,
                    isAnswer: true
                });
            expect(issues.filter(it => it.code === 'action.notInAnswer')).toMatchObject([
                {path: '/elements/reportActions/config/buttons/0/action/type'}
            ]);
            expect(validate(bp).filter(it => it.code === 'action.notInAnswer')).toEqual([]);
        });
    });

    describe('filters over server fields', () => {
        /** P2 with its sector chart showing VaR, a server field, under the given filter. */
        const varChart = (filter: unknown) => {
            const bp = p2();
            bp.elements.sectorChart.config.y = ['var95'];
            bp.elements.sectorChart.config.filter = filter;
            return bp;
        };
        const foldIssues = (bp: Blueprint, reg = registry) =>
            validateBlueprint(bp, {
                catalog: portfolioCatalog,
                registry: reg,
                artifacts: ARTIFACTS
            }).filter(it => it.code === 'filter.cannotFold');

        it.each([
            ['an equality on a dimension', {field: 'strategy', op: '=', value: 'Credit'}],
            [
                'an AND of equalities',
                {
                    filters: [
                        {field: 'strategy', op: '=', value: 'Credit'},
                        {field: 'trader', op: '=', value: 'Fred Corn'}
                    ]
                }
            ],
            ['a single-select grid selection', {$var: 'selection'}]
        ])('folds %s, so it gives no warning', (_, filter) => {
            expect(foldIssues(varChart(filter))).toEqual([]);
        });

        it.each([
            ['a list value', {field: 'strategy', op: '=', value: ['Credit', 'Global Macro']}],
            ['another operator', {field: 'strategy', op: '!=', value: 'Credit'}],
            ['a clause on a non-dimension', {field: 'mktVal', op: '>', value: 0}],
            [
                'an OR',
                {
                    op: 'OR',
                    filters: [
                        {field: 'strategy', op: '=', value: 'Credit'},
                        {field: 'trader', op: '=', value: 'Fred Corn'}
                    ]
                }
            ]
        ])('warns on %s, at the filter', (_, filter) => {
            expect(foldIssues(varChart(filter))).toMatchObject([
                {severity: 'warning', path: '/elements/sectorChart/config/filter'}
            ]);
        });

        it('warns on a filter a prompt sets', () => {
            const bp = varChart({$var: 'picked'});
            bp.variables.picked = {type: 'filter', setBy: 'prompt'};
            expect(foldIssues(bp)).toHaveLength(1);
        });

        it('warns on a selection that can hold several values, as a multi-select grid sets', () => {
            const reg = scenarioRegistry();
            reg.addWidgets({
                ...reg.widgets.cubeGrid,
                name: 'acme.multiGrid',
                outputs: [{name: 'selection', type: 'filter'}]
            });
            const bp = varChart({$var: 'selection'});
            bp.elements.posGrid.component = 'acme.multiGrid';
            expect(foldIssues(bp, reg)).toHaveLength(1);
        });

        it('gives no warning on a widget that shows no server field', () => {
            const bp = p2();
            bp.elements.sectorChart.config.filter = {field: 'mktVal', op: '>', value: 0};
            expect(foldIssues(bp)).toEqual([]);
        });
    });

    describe('cubeGrid', () => {
        it('warns on a grid with no columns, at its config', () => {
            const bp = p2();
            delete bp.elements.posGrid.config.columnState;
            expect(validate(bp)).toMatchObject([
                {code: 'cubeGrid.noColumns', severity: 'warning', path: '/elements/posGrid/config'}
            ]);
        });

        it('takes columns from a preset that controls them', () => {
            const issues = validate(loadBlueprint('p3-morning-report.json'));
            expect(issues.filter(it => it.code === 'cubeGrid.noColumns')).toEqual([]);
        });
    });

    describe('layout', () => {
        it('refuses canvas children that overlap', () => {
            const bp = p2();
            bp.elements.dashboard.children[2] = {id: 'sectorChart', x: 6, y: 2, w: 4, h: 7};
            const [issue] = validate(bp);
            expect(issue).toMatchObject({
                code: 'layout.overlap',
                path: '/elements/dashboard/children/1'
            });
        });

        it('refuses a canvas child past the last column', () => {
            const bp = p2();
            bp.elements.dashboard.config = {columns: 10};
            expect(codes(bp)).toEqual([
                'layout.outOfBounds',
                'layout.outOfBounds',
                'layout.outOfBounds'
            ]);
        });

        it('refuses an element with no parent', () => {
            const bp = p2();
            bp.elements.stray = {
                component: 'cubeGrid',
                config: {source: 'orders', columnState: ['dir']}
            };
            expect(codes(bp)).toEqual(['structure.notPlaced']);
        });
    });

    describe('variables', () => {
        it('refuses resolver arguments that read each other in a cycle, naming its path', () => {
            const bp = p2(),
                offset = (from: string) => ({
                    resolver: 'dateOffset',
                    args: {from: {$var: from}, days: 1}
                });
            bp.variables.a = {type: 'localDate', setBy: 'resolver', compute: offset('b')};
            bp.variables.b = {type: 'localDate', default: offset('a')};
            const issues = validate(bp);
            expect(issues).toHaveLength(1);
            expect(issues[0]).toMatchObject({code: 'variable.cycle', path: '/variables/a/compute'});
            expect(issues[0].message).toMatch(/a -> b -> a/);
        });

        it("takes options from a list or a source's field, and refuses any other form", () => {
            const check = (options: object) => {
                const bp = p2();
                bp.variables.sector = {type: 'string', setBy: 'prompt', options} as any;
                return validate(bp).map(it => [it.code, it.path]);
            };
            expect(check({values: ['Energy']})).toEqual([]);
            expect(check({source: 'positions', field: 'sector'})).toEqual([]);
            expect(check({source: 'nope', field: 'sector'})).toEqual([
                ['source.unknown', '/variables/sector/options/source']
            ]);
            expect(check({source: 'positions', field: 'nope'})).toEqual([
                ['field.unknown', '/variables/sector/options/field']
            ]);
            expect(check({dataset: 'positions', field: 'sector'})).toEqual([
                ['variable.badOptions', '/variables/sector/options']
            ]);
        });

        it('accepts resolver arguments that read other variables without a cycle', () => {
            const bp = loadBlueprint('p3-morning-report.json');
            expect(validate(bp).filter(it => it.code === 'variable.cycle')).toEqual([]);
        });

        it("takes a field instance's label, and refuses one that is not text", () => {
            const bp = loadBlueprint('p5-risk-report.json');
            (bp.sources.positions.fields.shockDown10 as any).label = 'Down 10%';
            expect(validate(bp).filter(it => it.severity === 'error')).toEqual([]);
            (bp.sources.positions.fields.shockDown10 as any).label = 10;
            expect(validate(bp)).toMatchObject([
                {code: 'source.badOverride', path: '/sources/positions/fields/shockDown10/label'}
            ]);
        });

        it('refuses a literal source parameter outside a chat answer', () => {
            const bp = p2();
            bp.sources.orders.params.asOf = '2026-11-18';
            expect(codes(bp)).toEqual(['source.literalParam']);
            expect(validate(bp, true)).toEqual([]);
        });

        it('refuses a binding to an unknown variable', () => {
            const bp = p2();
            bp.elements.ordersGrid.config.filter = {$var: 'nope'};
            expect(validate(bp)).toMatchObject([
                {code: 'variable.unknown', path: '/elements/ordersGrid/config/filter'}
            ]);
        });

        it('refuses several writers on a variable that is not a filter', () => {
            const bp = p2();
            bp.variables.asOf.setBy = [{element: 'posGrid', output: 'selection'}];
            expect(codes(bp)).toEqual(['variable.typeMismatch']);
        });
    });

    it('refuses a child whose widget its container does not accept, by category or by name', () => {
        const reg = scenarioRegistry();
        reg.addWidgets({
            name: 'acme.strip',
            version: 1,
            label: 'Strip',
            guidance: 'Lays out cards.',
            category: 'container',
            config: {type: 'object'},
            children: {
                schema: {type: 'object', required: ['id'], properties: {id: {type: 'string'}}},
                accepts: {categories: ['data'], widgets: ['separator']}
            }
        });
        const bp: Blueprint = {
                schema: {blueprint: 1},
                variables: {
                    asOf: {type: 'localDate', setBy: 'prompt', default: {resolver: 'today'}}
                },
                sources: {positions: {dataset: 'positions', params: {asOf: {$var: 'asOf'}}}},
                root: 'strip',
                elements: {
                    strip: {
                        component: 'acme.strip',
                        children: [{id: 'grid'}, {id: 'rule'}, {id: 'inner'}]
                    },
                    grid: {component: 'cubeGrid', config: {source: 'positions'}},
                    rule: {component: 'separator', config: {}},
                    inner: {component: 'box', config: {}, children: []}
                }
            },
            issues = validateBlueprint(bp, {catalog: portfolioCatalog, registry: reg}).filter(
                it => it.severity === 'error'
            );
        expect(issues.map(it => [it.code, it.path])).toEqual([
            ['element.notAccepted', '/elements/strip/children/2/id']
        ]);
        expect(issues[0].message).toMatch(/It takes data widgets and separator\.$/);
    });

    describe('templates', () => {
        const report = (text: string): Blueprint => {
            const bp = p2();
            bp.elements.note = {component: 'markdown', config: {source: 'positions', text}};
            (bp.elements.dashboard.children as PlainObject[]).push({
                id: 'note',
                x: 0,
                y: 14,
                w: 12,
                h: 2
            });
            return bp;
        };

        it('reads variables, fields of its own source, and fields of any source', () => {
            expect(
                codes(report('As of {asOf}: {mktVal}, with {orders.commission}. {{literal}}'))
            ).toEqual([]);
            expect(codes(report('{sector}'))).toEqual([]);
            expect(codes(report('{orders.quantity}'))).toEqual(['template.unique']);
        });

        it('warns of a figure written into report text, which goes stale, outside an answer', () => {
            for (const text of [
                'It made +$168,090 of the day.',
                'Up 12.5% since Monday.',
                'NAV is 3,754,900.'
            ]) {
                expect(codes(report(text))).toEqual(['template.literalFigure']);
            }
            for (const text of ['Top 10 holdings, as of {asOf}.', 'Q3 review: {mktVal}.']) {
                expect(codes(report(text))).toEqual([]);
            }
        });

        it('refuses a reference to no variable, source or field, at the text', () => {
            const issues = validate(
                report('{nothing} {nowhere.mktVal} {orders.nope} {bad ref}')
            ).map(it => [it.code, it.path]);
            expect(issues).toEqual([
                ['template.unknownRef', '/elements/note/config/text'],
                ['source.unknown', '/elements/note/config/text'],
                ['field.unknown', '/elements/note/config/text'],
                ['template.badRef', '/elements/note/config/text']
            ]);
        });
    });

    it('warns of a separator label in a toolbar, which cannot show one', () => {
        const bp: Blueprint = {
            schema: {blueprint: 1},
            root: 'bar',
            elements: {
                bar: {component: 'toolbar', config: {}, children: [{id: 'rule'}]},
                rule: {component: 'separator', config: {label: 'or'}}
            }
        };
        expect(codes(bp)).toEqual(['separator.labelIgnored']);
    });

    it('refuses an input for a variable of a type it cannot set', () => {
        const bp: Blueprint = {
            schema: {blueprint: 1},
            variables: {n: {type: 'number', setBy: {element: 'pick'}}},
            root: 'pick',
            elements: {pick: {component: 'select', config: {}}}
        };
        expect(codes(bp)).toEqual(['variable.typeMismatch']);
    });

    describe('time types', () => {
        const withVariable = (decl: object): Blueprint => {
            const bp = p2();
            bp.variables.when = {setBy: 'prompt', ...decl} as any;
            return bp;
        };

        it("takes a date range of Hoist's presets or the app's, and refuses an unknown preset", () => {
            const reg = scenarioRegistry();
            reg.addDateRangePresets({
                token: 'acme.fiscalYtd',
                label: 'FYTD',
                resolve: ctx => ({start: ctx.anchorDate.startOfYear(), end: ctx.anchorDate})
            });
            const check = (value: unknown) =>
                validateBlueprint(withVariable({type: 'dateRange', default: {value}}), {
                    catalog: portfolioCatalog,
                    registry: reg
                }).map(it => it.code);
            expect(check('mtd')).toEqual([]);
            expect(check({kind: 'preset', token: 'acme.fiscalYtd', offset: -1})).toEqual([]);
            expect(check({kind: 'relative', count: 3, unit: 'months'})).toEqual([]);
            expect(check('fiscalYtd')).toEqual(['variable.badValue']);
            expect(check({kind: 'era'})).toEqual(['variable.badValue']);
        });

        it("takes a date range's asOf as a binding to a localDate variable", () => {
            const ok = withVariable({type: 'dateRange', asOf: {$var: 'asOf'}}),
                bad = withVariable({type: 'dateRange', asOf: '2026-01-02'});
            expect(codes(ok)).toEqual([]);
            expect(codes(bad)).toEqual(['variable.badAsOf']);
        });

        it("refuses a picker's preset that the registry lacks", () => {
            const bp = withVariable({type: 'dateRange', setBy: {element: 'pick'}});
            bp.elements.pick = {component: 'dateRangePicker', config: {presets: ['mtd', 'bogus']}};
            (bp.elements.dashboard.children as PlainObject[]).push({
                id: 'pick',
                x: 0,
                y: 14,
                w: 3,
                h: 1
            });
            expect(validate(bp).map(it => [it.code, it.path])).toEqual([
                ['dateRangePicker.unknownPreset', '/elements/pick/config/presets/1']
            ]);
        });

        it('takes a period as a count and a unit, back or forward, with its calendar', () => {
            const check = (decl: object) => codes(withVariable({type: 'period', ...decl}));
            expect(check({default: {value: '3M'}})).toEqual([]);
            expect(check({default: {value: '+5D'}, calendar: 'calendar'})).toEqual([]);
            expect(check({default: {value: '3m'}})).toEqual(['variable.badValue']);
            expect(check({default: {value: '0D'}})).toEqual(['variable.badValue']);
            expect(check({calendar: 'lunar'})).toEqual(['variable.badCalendar']);
        });

        it("warns of a resolver's calendar that differs from its period variable's", () => {
            const bp = withVariable({type: 'period', default: {value: '3M'}, calendar: 'calendar'}),
                start = (calendar?: string) => ({
                    type: 'localDate',
                    setBy: 'resolver',
                    compute: {
                        resolver: 'periodStart',
                        args: {
                            asOf: {$var: 'asOf'},
                            period: {$var: 'when'},
                            ...(calendar ? {calendar} : {})
                        }
                    }
                });
            bp.variables.start = start() as any;
            expect(codes(bp)).toEqual([]);
            bp.variables.start = start('business') as any;
            expect(codes(bp)).toEqual(['resolver.calendarMismatch']);
        });
    });

    it("lets a preset group control a treemap's groupBy, and refuses a treemap with neither", () => {
        const bp = p2();
        bp.elements.map = {
            component: 'treemap',
            config: {source: 'positions', value: 'mktVal'}
        };
        (bp.elements.dashboard.children as PlainObject[]).push({
            id: 'map',
            x: 0,
            y: 14,
            w: 6,
            h: 4
        });
        expect(codes(bp)).toEqual(['treemap.noGroupBy']);
        bp.presets = {
            views: {
                controls: [{path: '/elements/map/config/groupBy'}],
                default: 'a',
                items: {a: {set: {elements: {map: {config: {groupBy: ['sector']}}}}}}
            }
        };
        expect(codes(bp)).toEqual([]);
    });

    it("binds a grid's style and a chart's type to variables of their types", () => {
        const bp = p2();
        bp.variables.totals = {type: 'bool', setBy: 'prompt', default: {value: true}};
        bp.variables.depth = {type: 'int', setBy: 'prompt', default: {value: 1}};
        bp.variables.kind = {
            type: 'string',
            setBy: 'prompt',
            options: {values: ['bar', 'column']},
            default: {value: 'bar'}
        };
        Object.assign(bp.elements.posGrid.config, {
            summaryRow: {$var: 'totals'},
            expandLevel: {$var: 'depth'}
        });
        bp.elements.sectorChart.config.type = {$var: 'kind'};
        expect(codes(bp)).toEqual([]);
        bp.elements.posGrid.config.stripeRows = {$var: 'depth'};
        expect(codes(bp)).toContain('binding.typeMismatch');
    });

    it("refuses a bound variable whose options or default fall outside its prop's enum or range", () => {
        const bp = p2();
        bp.variables.chartType = {
            type: 'string',
            setBy: 'prompt',
            options: {values: ['line', 'spiral']},
            default: {value: 'line'}
        };
        bp.variables.depth = {type: 'int', setBy: 'prompt', default: {value: 9}};
        bp.elements.sectorChart.config.type = {$var: 'chartType'};
        bp.elements.posGrid.config.expandLevel = {$var: 'depth'};
        expect(validate(bp).map(it => [it.code, it.path])).toEqual([
            ['binding.outOfRange', '/elements/posGrid/config/expandLevel'],
            ['binding.outOfRange', '/elements/sectorChart/config/type']
        ]);
    });

    it('refuses a binding where the schema allows none', () => {
        const bp = p2();
        bp.elements.sectorChart.config.sortBy = {$var: 'asOf'};
        (bp.elements.dashboard.children as PlainObject[])[0].w = {$var: 'asOf'};
        expect(validate(bp).map(it => [it.code, it.path, /binding/.test(it.message)])).toEqual([
            ['schema.invalid', '/elements/dashboard/children/0/w', true],
            ['schema.invalid', '/elements/sectorChart/config/sortBy', true]
        ]);
    });

    describe("a chart's highchartsConfig", () => {
        const chartWith = (highchartsConfig: object) => {
            const bp = p2();
            bp.elements.sectorChart.config.highchartsConfig = highchartsConfig;
            return bp;
        };

        it('takes the options of its allowlist, with Highcharts format templates', () => {
            expect(
                codes(
                    chartWith({
                        title: {text: 'P&L by sector'},
                        legend: {enabled: false},
                        tooltip: {pointFormat: '{series.name}: {point.y}'},
                        yAxis: [{min: 0}, {opposite: true}],
                        plotOptions: {column: {borderRadius: 2}},
                        chart: {spacingTop: 4}
                    })
                )
            ).toEqual([]);
        });

        it('refuses other keys, references into the page, markup, and remapping of its data', () => {
            const at = '/elements/sectorChart/config/highchartsConfig';
            expect(
                validate(
                    chartWith({
                        credits: {enabled: false},
                        chart: {renderTo: 'other'},
                        title: {text: '<b>Bold</b>'},
                        tooltip: {useHTML: true},
                        plotOptions: {series: {events: {}, keys: ['y']}},
                        xAxis: {categories: ['a']},
                        yAxis: [{categories: ['b']}],
                        legend: {series: []}
                    })
                ).map(it => [it.code, it.path])
            ).toEqual(
                [
                    '/credits',
                    '/chart/renderTo',
                    '/title/text',
                    '/tooltip/useHTML',
                    '/plotOptions/series/events',
                    '/plotOptions/series/keys',
                    '/xAxis/categories',
                    '/yAxis/0/categories',
                    '/legend/series'
                ].map(it => ['chart.highchartsConfig', `${at}${it}`])
            );
        });

        it('refuses a config past its size or depth cap', () => {
            let deep: any = {};
            const root = deep;
            for (let i = 0; i < 12; i++) deep = deep.a = {};
            expect(codes(chartWith({chart: root}))).toEqual(['chart.highchartsConfig']);
            expect(codes(chartWith({title: {text: 'x'.repeat(20001)}}))).toEqual([
                'chart.highchartsConfig'
            ]);
        });

        it('refuses exporting and credits, and a key that names a URL at any depth', () => {
            const at = '/elements/sectorChart/config/highchartsConfig';
            expect(
                validate(
                    chartWith({
                        exporting: {
                            enabled: true,
                            libURL: 'https://evil.example/',
                            buttons: {contextButton: {menuItems: ['downloadPDF']}}
                        },
                        credits: {enabled: true, href: 'https://evil.example', text: 'Source'},
                        plotOptions: {series: {point: {url: 'https://evil.example'}}},
                        title: {style: {background: '\\75 rl(https://evil.example/x.png)'}},
                        legend: {itemStyle: {background: '\\75 rl(https://evil.example/x.png)'}}
                    })
                ).map(it => [it.code, it.path])
            ).toEqual([
                ['chart.highchartsConfig', `${at}/exporting`],
                ['chart.highchartsConfig', `${at}/credits`],
                ['chart.highchartsConfig', `${at}/plotOptions/series/point/url`],
                ['chart.highchartsConfig', `${at}/title/style/background`],
                ['chart.highchartsConfig', `${at}/legend/itemStyle/background`]
            ]);
        });

        it('refuses a binding anywhere in it, and options that load from a URL', () => {
            const at = '/elements/sectorChart/config/highchartsConfig';
            expect(
                validate(
                    chartWith({
                        title: {text: {$var: 'asOf'}},
                        chart: {plotBackgroundImage: 'https://evil.example/x.png'},
                        subtitle: {style: {background: 'url(https://evil.example/x.png)'}}
                    })
                ).map(it => [it.code, it.path])
            ).toEqual([
                ['chart.highchartsConfig', `${at}/title/text`],
                ['chart.highchartsConfig', `${at}/chart/plotBackgroundImage`],
                ['chart.highchartsConfig', `${at}/subtitle/style/background`]
            ]);
        });
    });

    it('refuses a widget whose schema uses JSON Schema the validator lacks', () => {
        const spec = {
            name: 'acme.bad',
            version: 1,
            label: 'Bad',
            guidance: '',
            category: 'data' as const,
            config: {$ref: '#/$defs/x'}
        };
        expect(() => new BlueprintRegistry({widgets: [spec]})).toThrow(/\$ref/);
    });
});
