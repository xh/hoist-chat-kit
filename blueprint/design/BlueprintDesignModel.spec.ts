import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import type {Blueprint} from '../Blueprint';
import {BlueprintModel} from '../BlueprintModel';
import {FakeBlueprintDataProvider} from '../FakeBlueprintDataProvider';
import {BlueprintDesignModel} from './BlueprintDesignModel';

/**
 * Design mode for people: each change a designer makes is one edit, by the user, with a
 * description, so undo and history work, and the blueprint stays valid.
 */
describe('BlueprintDesignModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(blueprint: Blueprint, opts: {isAnswer?: boolean} = {}) {
        const model = new BlueprintModel({
                blueprint,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write',
                isAnswer: opts.isAnswer
            }),
            design = new BlueprintDesignModel({blueprintModel: model});
        onTestFinished(() => {
            design.destroy();
            model.destroy();
        });
        return {model, design};
    }
    const errors = (r: {issues: {severity: string}[]}) =>
        r.issues.filter(it => it.severity === 'error');

    it('has no design mode for a chat answer', () => {
        expect(() => open(loadBlueprint('w3-segment-1.json'), {isAnswer: true})).toThrow(
            /answer has no design mode/
        );
    });

    it.each([
        'cubeGrid',
        'chart',
        'statCardStrip',
        'groupingChooser',
        'buttonGroup',
        'buttonGroupInput',
        'dashCanvas',
        'tabContainer'
    ])('adds a %s that starts valid, on the first free place of the root canvas', component => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            result = design.addWidget(component);
        expect(errors(result)).toEqual([]);
        expect(model.blueprint.elements[result.id].component).toBe(component);
        const ref = model.blueprint.elements.dashboard.children.find(it => it.id === result.id);
        expect(ref).toMatchObject({x: expect.any(Number), y: expect.any(Number)});
        expect(model.history.at(-1)).toMatchObject({author: 'user'});
    });

    it('starts widgets with configs that show data: distinct values, fields used once, totals', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            config = (component: string) => {
                const {id} = design.addWidget(component);
                return model.blueprint.elements[id].config;
            },
            fields = portfolioCatalog.getDataset('positions').fields,
            totals = (name: string) =>
                ![null, undefined, 'UNIQUE'].includes(fields[name]?.aggregator as string);

        const toggle = config('buttonGroupInput');
        expect(new Set(toggle.options.map(it => it.value)).size).toBe(toggle.options.length);

        const grid = config('cubeGrid');
        expect(grid.columnState.length).toBeGreaterThan(0);
        grid.columnState.forEach(it => {
            expect(grid.groupBy).not.toContain(it);
            expect(totals(it)).toBe(true);
        });

        const chart = config('chart');
        expect(chart.groupBy).not.toBe(chart.x);
        expect(totals(chart.y[0])).toBe(true);

        expect(totals(config('statCardStrip').cards[0].field)).toBe(true);
    });

    it('places a widget where it fits, and names it after its widget', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            first = design.addWidget('chart'),
            second = design.addWidget('chart'),
            refs = model.blueprint.elements.dashboard.children;
        expect([first.id, second.id]).toEqual(['chart1', 'chart2']);
        expect(model.history.at(-1).description).toBe('Add Chart');
        const box = (id: string) => refs.find(it => it.id === id) as any;
        const overlaps = (a: any, b: any) =>
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        refs.filter(it => it.id !== 'chart1').forEach(it =>
            expect(overlaps(box('chart1'), it)).toBe(false)
        );
    });

    it('gives a container placed on a canvas room for widgets of its own', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            place = (component: string) => {
                const {id} = design.addWidget(component, 'dashboard');
                return model.blueprint.elements.dashboard.children.find(it => it.id === id);
            };
        expect(place('dashCanvas')).toMatchObject({w: 12, h: 8});
        expect(place('tabContainer')).toMatchObject({w: 12, h: 8});
    });

    it('adds into the selected container, a tab with a title', () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json'));
        design.select({kind: 'element', id: 'tabs'});
        const {id} = design.addWidget('dashCanvas');
        expect(model.blueprint.elements.tabs.children.at(-1)).toEqual({id, title: 'Dashboard'});
    });

    it('makes the first widget of an empty blueprint its root', () => {
        const {model, design} = open(undefined),
            result = design.addWidget('dashCanvas');
        expect(errors(result)).toEqual([]);
        expect(model.blueprint.root).toBe(result.id);
        expect(errors(design.addWidget('cubeGrid'))).toMatchObject([
            {message: 'Add a source for the Grid to read first.'}
        ]);
    });

    it('retitles and reorders a tab, each as one edit', () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json')),
            tabs = () => model.blueprint.elements.tabs.children,
            [first, second] = tabs();
        design.setChildTitle(second.id, 'Book');
        expect(tabs()[1]).toEqual({...second, title: 'Book'});
        expect(model.history.at(-1).description).toBe('Retitle Dashboard');

        design.moveElement(second.id, 'tabs', {index: 0});
        expect(
            tabs()
                .map(it => it.id)
                .slice(0, 2)
        ).toEqual([second.id, first.id]);
        model.undo();
        model.undo();
        expect(tabs()[1]).toEqual(second);
    });

    describe('variables', () => {
        it('adds a variable with a name of its own, and selects it', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                {id, issues} = design.addVariable();
            expect(errors({issues})).toEqual([]);
            expect(id).toBe('variable1');
            expect(model.blueprint.variables.variable1).toEqual({type: 'string', setBy: 'prompt'});
            expect(design.selection).toEqual({kind: 'variable', id: 'variable1'});
            expect(model.history.at(-1).description).toBe('Add variable variable1');
            expect(design.addVariable().id).toBe('variable2');
        });

        it('sets or removes one key of a declaration as one edit', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json'));
            design.setVariableDecl('symbol', 'label', 'Ticker');
            expect(model.blueprint.variables.symbol.label).toBe('Ticker');
            expect(model.history.at(-1).description).toBe('Variable symbol: label');
            design.setVariableDecl('symbol', 'label', undefined);
            expect(model.blueprint.variables.symbol).not.toHaveProperty('label');

            const compute = {resolver: 'today'};
            expect(
                errors(design.updateVariableDecl('symbol', {setBy: 'resolver', compute}))
            ).toEqual([]);
            expect(model.blueprint.variables.symbol).toMatchObject({setBy: 'resolver', compute});
            expect(model.history.at(-1).description).toBe('Variable symbol: setBy, compute');
        });

        it('removes a variable nothing reads, and refuses one a widget reads', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json'));
            expect(errors(design.removeVariable('grouping')).length).toBeGreaterThan(0);
            expect(model.blueprint.variables).toHaveProperty('grouping');
            design.addVariable();
            expect(errors(design.removeVariable('variable1'))).toEqual([]);
            expect(model.blueprint.variables).not.toHaveProperty('variable1');
        });
    });

    describe('sources', () => {
        it('adds a dataset source with its required parameters bound, and selects it', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                {id, issues} = design.addSource('positions');
            expect(errors({issues})).toEqual([]);
            expect(id).toBe('positions1');
            expect(model.blueprint.sources.positions1).toEqual({
                dataset: 'positions',
                params: {asOf: {$var: 'asOf'}}
            });
            expect(design.selection).toEqual({kind: 'source', id: 'positions1'});
            expect(model.history.at(-1).description).toBe('Add source positions1');
        });

        it('refuses a source whose required parameter no variable can take', () => {
            const {design} = open(undefined),
                result = design.addSource('positions');
            expect(errors(result)).toMatchObject([
                {message: expect.stringMatching(/Add a localDate variable for asOf first/)}
            ]);
        });

        it('names the widgets a dataset change would break, and can remove them in the same edit', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                {breaks} = design.describeDatasetChange('positions', 'orders');
            expect(breaks).toEqual(expect.arrayContaining(['posGrid']));
            expect(errors(design.changeSourceDataset('positions', 'orders'))).not.toEqual([]);

            const result = design.changeSourceDataset('positions', 'orders', {
                removeBreaking: true
            });
            expect(errors(result)).toEqual([]);
            expect(model.blueprint.sources.positions.dataset).toBe('orders');
            breaks.forEach(it => expect(model.blueprint.elements).not.toHaveProperty(it));
            model.undo();
            expect(model.blueprint.sources.positions.dataset).toBe('positions');
        });

        it('sets keys of a declaration together, and removes a source nothing reads', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json'));
            design.addSource('positions');
            expect(
                errors(
                    design.updateSourceDecl('positions1', {
                        fields: {mktVal: {label: 'Value'}}
                    })
                )
            ).toEqual([]);
            expect(model.blueprint.sources.positions1.fields).toEqual({mktVal: {label: 'Value'}});
            expect(errors(design.removeSource('positions'))).not.toEqual([]);
            expect(errors(design.removeSource('positions1'))).toEqual([]);
            expect(model.blueprint.sources).not.toHaveProperty('positions1');
        });
    });

    describe('presets', () => {
        const SORT = '/elements/posGrid/config/sortBy',
            COLUMNS = '/elements/posGrid/config/columnState';

        it("makes a group from an element's preset path, with one preset of its value", () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                {id, issues} = design.addPresetGroup(SORT);
            expect(errors({issues})).toEqual([]);
            expect(id).toBe('group1');
            expect(model.blueprint.elements.posGrid.config).not.toHaveProperty('sortBy');
            expect(model.blueprint.presets.group1).toEqual({
                label: 'Sort by',
                controls: [{path: SORT}],
                default: 'preset1',
                items: {
                    preset1: {
                        label: 'Preset 1',
                        set: {elements: {posGrid: {config: {sortBy: 'pnlDay|desc'}}}}
                    }
                }
            });
            expect(design.selection).toEqual({kind: 'preset', id: 'group1'});
        });

        it('adds a control to every preset of a group, and gives it back to the config', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json'));
            expect(errors(design.addPresetControl('posViews', SORT))).toEqual([]);
            const {items} = model.blueprint.presets.posViews;
            Object.values(items).forEach(it =>
                expect(it.set.elements.posGrid.config.sortBy).toBe('pnlDay|desc')
            );

            model.setPreset('posViews', 'risk');
            expect(errors(design.removePresetControl('posViews', COLUMNS))).toEqual([]);
            expect(model.blueprint.elements.posGrid.config.columnState).toEqual(
                items.risk.set.elements.posGrid.config.columnState
            );
            Object.values(model.blueprint.presets.posViews.items).forEach(it =>
                expect(it.set.elements.posGrid.config).not.toHaveProperty('columnState')
            );
        });

        it('duplicates, relabels and removes a preset, keeping a default', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                group = () => model.blueprint.presets.posViews;
            const {id} = design.duplicatePreset('posViews', 'pnl');
            expect(id).toBe('preset1');
            expect(group().items.preset1).toEqual({...group().items.pnl, label: 'P&L view copy'});
            design.setPresetLabel('posViews', 'preset1', 'Mine');
            expect(group().items.preset1.label).toBe('Mine');

            expect(errors(design.removePreset('posViews', 'pnl'))).toEqual([]);
            expect(group().default).toBe('risk');
            design.removePreset('posViews', 'preset1');
            expect(errors(design.removePreset('posViews', 'risk')).length).toBeGreaterThan(0);
        });

        it("makes presets of a variable's default, which edits, renames and removal follow", () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                FUND = '/variables/fund/default';
            design.addVariable();
            design.setVariableDecl('variable1', 'default', {value: 'A'});
            const {id} = design.addPresetGroup('/variables/variable1/default');
            expect(model.blueprint.variables.variable1).not.toHaveProperty('default');
            expect(model.blueprint.presets[id].items.preset1.set).toEqual({
                variables: {variable1: {default: {value: 'A'}}}
            });

            design.setVariableDecl('variable1', 'default', {value: 'B'});
            expect(
                model.blueprint.presets[id].items.preset1.set.variables.variable1.default
            ).toEqual({
                value: 'B'
            });

            design.renameId('variable', 'variable1', 'book');
            expect(model.blueprint.presets[id].controls).toEqual([
                {path: '/variables/book/default'}
            ]);
            expect(errors(design.removeVariable('book'))).toEqual([]);
            expect(model.blueprint.presets ?? {}).not.toHaveProperty(id);

            expect(errors(design.addPresetGroup(FUND))).toEqual([]);
        });

        it('removes a group, giving its paths back to the config at the active preset', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json'));
            model.setPreset('posViews', 'risk');
            const risk = model.blueprint.presets.posViews.items.risk.set.elements.posGrid.config;
            expect(errors(design.removePresetGroup('posViews'))).toEqual([]);
            expect(model.blueprint.presets ?? {}).not.toHaveProperty('posViews');
            expect(model.blueprint.elements.posGrid.config.columnState).toEqual(risk.columnState);
        });
    });

    describe('removing an element', () => {
        it('removes everything inside it, and what names it, in one edit that undoes', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                before = model.blueprint,
                removal = design.describeRemoval('positions');
            expect(removal.elements).toEqual(
                expect.arrayContaining(['positions', 'posGrid', 'groupChooser'])
            );
            expect(removal.presetPaths).toEqual(['/elements/posGrid/config/columnState']);

            const {version} = model;
            expect(errors(design.removeElement('positions'))).toEqual([]);
            expect(model.version).toBe(version + 1);
            removal.elements.forEach(id => expect(model.blueprint.elements[id]).toBeUndefined());
            expect(model.blueprint.presets?.posViews).toBeUndefined();
            removal.removedVariables.forEach(name =>
                expect(model.blueprint.variables[name]).toBeUndefined()
            );
            removal.unboundVariables.forEach(name =>
                expect(JSON.stringify(model.blueprint.variables[name]?.setBy ?? null)).not.toMatch(
                    /posGrid|groupChooser/
                )
            );

            model.undo();
            expect(model.blueprint).toEqual(before);
        });

        it('keeps a variable another element reads, without the removed writer', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                removal = design.describeRemoval('posGrid');
            expect(removal.unboundVariables).toEqual(['selection']);
            expect(errors(design.removeElement('posGrid'))).toEqual([]);
            expect(model.blueprint.variables.selection).toBeDefined();
            expect(model.blueprint.variables.selection.setBy).toBeUndefined();
        });
    });

    it('moves and renames as one edit each, and keeps the selection on a rename', () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json'));
        design.select({kind: 'element', id: 'posGrid'});
        expect(errors(design.renameId('element', 'posGrid', 'positionsGrid'))).toEqual([]);
        expect(design.selection).toEqual({kind: 'element', id: 'positionsGrid'});
        expect(model.history.at(-1).ops).toEqual([
            {op: 'renameId', kind: 'element', from: 'posGrid', to: 'positionsGrid'}
        ]);
        expect(
            errors(design.moveElement('priceChart', 'overview', {child: {x: 0, y: 30, w: 4, h: 4}}))
        ).toEqual([]);
        expect(model.blueprint.elements.overview.children.at(-1).id).toBe('priceChart');
    });

    it("sets an element's config, or the active preset's value for a path presets control", () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json'));
        expect(errors(design.setConfig('posGrid', '/title', 'Positions'))).toEqual([]);
        expect(model.blueprint.elements.posGrid.config.title).toBe('Positions');
        expect(model.history.at(-1).description).toBe('Grid: title');

        design.setConfig('posGrid', '/columnState', ['mktVal']);
        expect(
            model.blueprint.presets.posViews.items.pnl.set.elements.posGrid.config.columnState
        ).toEqual(['mktVal']);
        design.setConfig('posGrid', '/title', undefined);
        expect(model.blueprint.elements.posGrid.config.title).toBeUndefined();
    });

    it('clears the selection when what it names is gone', () => {
        const {design} = open(loadBlueprint('p2-linked-dashboard.json'));
        design.select({kind: 'element', id: 'sectorChart'});
        design.removeElement('sectorChart');
        expect(design.selection).toBeNull();
    });
});
