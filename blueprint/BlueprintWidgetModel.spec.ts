import {autorun} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../test/blueprintFixtures';
import {BlueprintModel} from './BlueprintModel';
import {BlueprintWidgetModel} from './BlueprintWidgetModel';
import {FakeBlueprintDataProvider} from './FakeBlueprintDataProvider';

/**
 * A widget that shows a value, such as a grouping chooser, is connected to the variable whose
 * `setBy` names it, and sets that variable as a user changes the value.
 */
describe('BlueprintWidgetModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open() {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.variables.grouping = {
            type: 'string[]',
            setBy: {element: 'chooser'},
            default: {value: ['strategy', 'trader']}
        };
        bp.elements.chooser = {
            component: 'groupingChooser',
            config: {dimensions: ['strategy', 'trader', 'sector']}
        };
        bp.elements.dashboard.children.push({id: 'chooser', x: 0, y: 14, w: 4, h: 1});
        bp.elements.posGrid.config.groupBy = {$var: 'grouping'};
        const model = new BlueprintModel({
            blueprint: bp,
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog})
        });
        onTestFinished(() => model.destroy());
        return model;
    }

    const errorsOf = (r: {issues: {severity: string}[]}) =>
        r.issues.filter(it => it.severity === 'error');

    const widget = (model: BlueprintModel, id: string) => {
        const ret = new BlueprintWidgetModel({
            blueprintModel: model,
            id,
            renderElement: () => null
        });
        onTestFinished(() => ret.destroy());
        return ret;
    };

    it('keeps its element through an edit to another element, so its view does not draw again', () => {
        const model = open(),
            grid = widget(model, 'posGrid'),
            set = (path: string, value: unknown) =>
                expect(errorsOf(model.applyEdit({ops: [{op: 'set', path, value}]}))).toEqual([]);
        model.setMode('design');
        model.setAccess('write');
        let runs = 0;
        const dispose = autorun(() => {
            runs++;
            grid.element;
            grid.children;
        });
        onTestFinished(dispose);
        set('/elements/sectorChart/config/title', 'S');
        expect(runs).toBe(1);
        set('/elements/posGrid/config/columnState', ['mktVal']);
        expect(runs).toBe(2);
    });

    it('says why an edit would be refused, applying nothing, and refuses nothing in run mode', () => {
        const model = open();
        model.setAccess('write');
        model.setMode('design');
        const w = widget(model, 'dashboard'),
            children = model.blueprint.elements.dashboard.children,
            overlap = [
                {
                    op: 'set',
                    path: '/elements/dashboard/children',
                    value: children.map(it => (it.id === 'headline' ? {...it, y: 3} : it))
                } as const
            ],
            version = model.version;
        expect(w.canApplyUserEdit(overlap)).toMatch(/overlaps/);
        expect(model.version).toBe(version);
        expect(
            w.canApplyUserEdit([{op: 'set', path: '/elements/posGrid/config/title', value: 'P'}])
        ).toBeNull();
        model.setMode('run');
        expect(w.canApplyUserEdit(overlap)).toBeNull();
    });

    it('holds a reader’s changes under a path until they are cleared', () => {
        const model = open();
        model.setMode('run');
        model.setTransientValue('/elements/dashboard/children', []);
        model.setTransientValue('/elements/posGrid/config/sortBy', 'mktVal');
        expect(model.hasTransientValues('/elements/dashboard')).toBe(true);
        expect(model.hasTransientValues('/elements/dash')).toBe(false);

        model.clearTransientValues('/elements/dashboard');
        expect(model.hasTransientValues('/elements/dashboard')).toBe(false);
        expect(model.hasTransientValues('/elements/posGrid')).toBe(true);
        expect(model.effective.elements.dashboard.children).toEqual(
            model.blueprint.elements.dashboard.children
        );
    });

    it("leaves out a bound value that falls outside its prop's enum or range", () => {
        const model = open();
        model.setBlueprint({
            ...model.blueprint,
            variables: {
                ...model.blueprint.variables,
                chartType: {type: 'string', setBy: 'prompt', default: {value: 'bar'}},
                depth: {type: 'int', setBy: 'prompt'}
            },
            elements: {
                ...model.blueprint.elements,
                sectorChart: {
                    ...model.blueprint.elements.sectorChart,
                    config: {
                        ...model.blueprint.elements.sectorChart.config,
                        type: {$var: 'chartType'}
                    }
                },
                posGrid: {
                    ...model.blueprint.elements.posGrid,
                    config: {
                        ...model.blueprint.elements.posGrid.config,
                        expandLevel: {$var: 'depth'}
                    }
                }
            }
        });
        const chart = widget(model, 'sectorChart'),
            grid = widget(model, 'posGrid');
        model.setVariable('chartType', 'spiral');
        model.setVariable('depth', 9);
        expect(chart.resolvedConfig).not.toHaveProperty('type');
        expect(grid.resolvedConfig).not.toHaveProperty('expandLevel');
        model.setVariable('chartType', 'line');
        model.setVariable('depth', 2);
        expect(chart.resolvedConfig.type).toBe('line');
        expect(grid.resolvedConfig.expandLevel).toBe(2);
    });

    it('fills variables into its title and column headers as plain text, and follows them', () => {
        const model = open();
        model.setBlueprint({
            ...model.blueprint,
            elements: {
                ...model.blueprint.elements,
                sectorChart: {
                    ...model.blueprint.elements.sectorChart,
                    config: {...model.blueprint.elements.sectorChart.config, title: 'P&L, {asOf}'}
                },
                posGrid: {
                    ...model.blueprint.elements.posGrid,
                    config: {
                        ...model.blueprint.elements.posGrid.config,
                        columns: {mktVal: {headerName: 'MV {asOf} {{x}}'}}
                    }
                }
            }
        });
        model.setVariable('asOf', '2026-03-02');
        const chart = widget(model, 'sectorChart'),
            grid = widget(model, 'posGrid');
        expect(chart.resolvedConfig.title).toBe('P&L, 2026-03-02');
        expect(grid.resolvedConfig.columns.mktVal.headerName).toBe('MV 2026-03-02 {x}');
        expect(model.blueprint.elements.sectorChart.config.title).toBe('P&L, {asOf}');

        model.setVariable('asOf', '2026-03-03');
        expect(chart.resolvedConfig.title).toBe('P&L, 2026-03-03');
        expect(model.resolveTitle('As of {asOf}')).toBe('As of 2026-03-03');
    });

    it('fills only literal titles: a bound value shows as written, and a long fill is cut', () => {
        const model = open();
        model.setBlueprint({
            ...model.blueprint,
            variables: {
                ...model.blueprint.variables,
                desk: {type: 'string', setBy: 'prompt', default: {value: 'Desk {asOf}'}},
                note: {type: 'string', setBy: 'prompt', default: {value: 'x'.repeat(300)}}
            },
            elements: {
                ...model.blueprint.elements,
                sectorChart: {
                    ...model.blueprint.elements.sectorChart,
                    config: {...model.blueprint.elements.sectorChart.config, title: {$var: 'desk'}}
                }
            }
        });
        expect(widget(model, 'sectorChart').resolvedConfig.title).toBe('Desk {asOf}');
        expect(model.resolveTitle({$var: 'desk'})).toBe('Desk {asOf}');
        const long = model.resolveTitle('{note}');
        expect(long).toHaveLength(200);
        expect(long.endsWith('…')).toBe(true);
    });

    it('knows when its dashboard cell is narrower than its widget takes', () => {
        const model = open();
        expect(widget(model, 'posGrid').isTooNarrow).toBe(false);
        model.setBlueprint({
            ...model.blueprint,
            elements: {
                ...model.blueprint.elements,
                dashboard: {
                    ...model.blueprint.elements.dashboard,
                    children: model.blueprint.elements.dashboard.children.map(it =>
                        it.id === 'posGrid' ? {...it, w: 1} : it
                    )
                }
            }
        });
        expect(widget(model, 'posGrid').isTooNarrow).toBe(true);
    });

    it('shows the value of the variable its element sets, and sets it', () => {
        const model = open(),
            chooser = widget(model, 'chooser'),
            grid = widget(model, 'posGrid');

        expect(chooser.valueVariable.name).toBe('grouping');
        expect(chooser.value).toEqual(['strategy', 'trader']);

        chooser.setValue(['sector']);
        expect(model.getVariable('grouping').value).toEqual(['sector']);
        expect(grid.resolvedConfig.groupBy).toEqual(['sector']);
    });

    it("describes a user's change in design mode by its element and the property's label", () => {
        const model = open(),
            grid = widget(model, 'posGrid');
        model.setAccess('write');
        model.setMode('design');
        expect(grid.setConfig('/sortBy', 'mktVal|desc')).toBe(true);
        expect(model.history.at(-1).description).toBe('posGrid: sort by');
    });

    it('has no value variable when no variable names its element', () => {
        const model = open(),
            grid = widget(model, 'posGrid');
        expect(grid.valueVariable).toBeNull();
        expect(() => grid.setValue(['x'])).toThrow();
    });
});
