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
            bp.elements.posGrid.config.expandLevel = {$var: 'asOf'};
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
                name: 'multiGrid',
                outputs: [{name: 'selection', type: 'filter'}]
            });
            const bp = varChart({$var: 'selection'});
            bp.elements.posGrid.component = 'multiGrid';
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
                {code: 'schema.invalid', path: '/sources/positions/fields/shockDown10/label'}
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

    it('refuses a widget whose schema uses JSON Schema the validator lacks', () => {
        const spec = {
            name: 'bad',
            version: 1,
            label: 'Bad',
            guidance: '',
            category: 'data' as const,
            config: {$ref: '#/$defs/x'}
        };
        expect(() => new BlueprintRegistry({widgets: [spec]})).toThrow(/\$ref/);
    });
});
