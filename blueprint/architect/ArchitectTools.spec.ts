import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {BlueprintModel} from '../BlueprintModel';
import {BlueprintRegistry} from '../BlueprintRegistry';
import {FakeBlueprintDataProvider} from '../FakeBlueprintDataProvider';
import {fieldUsages} from '../usages';
import {architectPrompt} from './architectPrompt';
import type {ArchitectToolError} from './ArchitectTools';
import {
    ARCHITECT_TOOLS,
    runDatasetQueryAsync,
    type ArchitectTarget,
    availableArchitectTools
} from './ArchitectTools';

/**
 * The Architect's tools run in the browser against a blueprint model, with the same engine and
 * validator as every other edit. They give the model what it needs to read before it writes, and
 * refuse what the blueprint refuses.
 */
describe('Architect tools', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open() {
        const ret = new BlueprintModel({
            blueprint: loadBlueprint('p2-linked-dashboard.json'),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
            mode: 'design',
            access: 'write'
        });
        onTestFinished(() => ret.destroy());
        return ret;
    }

    const run = (name: string, input: any, target: ArchitectTarget) =>
        ARCHITECT_TOOLS.find(it => it.name === name).run(input, target) as any;

    it('reads the blueprint whole, or the subtrees at given paths, with its version', () => {
        const model = open();
        expect(run('read_blueprint', {}, model)).toEqual({version: 1, blueprint: model.blueprint});
        expect(
            run('read_blueprint', {paths: ['/elements/posGrid/config/groupBy', '/nope']}, model)
        ).toEqual({
            version: 1,
            parts: {'/elements/posGrid/config/groupBy': ['strategy', 'trader'], '/nope': null}
        });
    });

    it('lists datasets, and describes the fields of one, narrowed by a search', () => {
        const model = open(),
            list = run('describe_catalog', {}, model);
        expect(list.map(it => it.dataset)).toContain('positions');

        const {fields, params} = run(
            'describe_catalog',
            {dataset: 'positions', search: 'shock'},
            model
        );
        expect(fields.map(it => it.name)).toEqual(['shockedPnl']);
        expect(fields[0].params.shock.kind).toBe('shock');
        expect(params.asOf.required).toBe(true);
        expect(() => run('describe_catalog', {dataset: 'nope'}, model)).toThrow(/unknown dataset/);
    });

    it('lists registry entries in a line each, or gives full specs by name', () => {
        const model = open(),
            list = run('describe_registry', {kind: 'widget'}, model);
        expect(list.find(it => it.name === 'cubeGrid').label).toBe('Grid');

        const specs = JSON.parse(
            JSON.stringify(run('describe_registry', {kind: 'widget', names: ['cubeGrid']}, model))
        );
        expect(specs.cubeGrid.config.properties.columnState).toBeTruthy();
        expect(specs.cubeGrid.demand).toBeUndefined();
    });

    it('applies an edit as the Architect, and refuses one with errors, returning its issues', () => {
        const model = open(),
            ok = run(
                'edit_blueprint',
                {
                    base: 1,
                    description: 'Group by sector',
                    ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['sector']}]
                },
                model
            );
        expect(ok).toEqual({applied: true, version: 2, warnings: []});
        expect(model.history[0]).toMatchObject({
            author: 'architect',
            description: 'Group by sector'
        });

        let error: ArchitectToolError;
        try {
            run(
                'edit_blueprint',
                {
                    base: 2,
                    description: 'bad',
                    ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['mktVal']}]
                },
                model
            );
        } catch (e) {
            error = e;
        }
        expect(error.result).toMatchObject({
            applied: false,
            version: 2,
            issues: [{code: 'field.notDimension'}]
        });
        expect(() =>
            run(
                'edit_blueprint',
                {base: 1, description: 'stale', ops: [{op: 'remove', path: '/root'}]},
                model
            )
        ).toThrow(/staleBase/);
    });

    describe('mode and access', () => {
        const regroup = {
                base: 1,
                description: 'Group by sector',
                ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['sector']}]
            },
            refusal = (model: BlueprintModel, {mode, access}: any) => {
                model.setAccess(access);
                model.setMode(mode);
                try {
                    ARCHITECT_TOOLS.find(it => it.name === 'edit_blueprint').run(regroup, model);
                } catch (e) {
                    return e.result.issues[0];
                }
                return null;
            };

        it('refuses every edit in run mode, at its first path, and offers design mode', () => {
            const model = open();
            expect(refusal(model, {mode: 'run', access: 'write'})).toMatchObject({
                code: 'edit.notAllowed',
                path: '/elements/posGrid/config/groupBy',
                message: expect.stringMatching(/run mode.*design mode/)
            });
            expect(model.version).toBe(1);
        });

        it('refuses every edit without write access, in any mode, and offers a copy', () => {
            const model = open();
            for (const mode of ['design', 'run']) {
                expect(refusal(model, {mode, access: 'read'})).toMatchObject({
                    code: 'edit.notAllowed',
                    message: expect.stringMatching(/read access.*copy/)
                });
            }
            expect(model.version).toBe(1);
        });

        it('applies edits in design mode with write access, and sets variables in run mode', async () => {
            const model = open();
            expect(refusal(model, {mode: 'design', access: 'write'})).toBeNull();
            expect(model.version).toBe(2);

            model.setAccess('read');
            expect(run('set_variable', {variable: 'asOf', value: '2026-07-01'}, model)).toEqual({
                variable: 'asOf',
                value: '2026-07-01'
            });
        });
    });

    it('refuses a dry run through __proto__, leaving Object.prototype alone', () => {
        const {issues} = run(
            'validate_blueprint',
            {ops: [{op: 'set', path: '/__proto__/polluted', value: 1}]},
            open()
        );
        expect(issues[0].code).toBe('path.forbidden');
        expect(({} as any).polluted).toBeUndefined();
    });

    it('reads no path through __proto__', () => {
        expect(() => run('read_blueprint', {paths: ['/__proto__/toString']}, open())).toThrow(
            /forbidden/
        );
    });

    it('checks the blueprint, or ops as a dry run that changes nothing', () => {
        const model = open();
        expect(run('validate_blueprint', {}, model)).toEqual({issues: []});
        expect(
            run(
                'validate_blueprint',
                {ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['mktVal']}]},
                model
            ).issues[0].code
        ).toBe('field.notDimension');
        expect(model.version).toBe(1);
    });

    it('sets a variable a prompt sets, and refuses one an output sets', () => {
        const model = open();
        expect(run('set_variable', {variable: 'asOf', value: '2026-07-01'}, model)).toEqual({
            variable: 'asOf',
            value: '2026-07-01'
        });
        expect(() => run('set_variable', {variable: 'selection', value: null}, model)).toThrow();
    });

    it('queries a dataset through the data provider, grouped, sorted and cut', async () => {
        const model = open(),
            art = await run(
                'query_dataset',
                {
                    dataset: 'positions',
                    params: {asOf: '2026-07-01'},
                    fields: ['mktVal'],
                    groupBy: ['sector'],
                    sortBy: 'mktVal|desc',
                    top: 2
                },
                model
            );
        expect(art.columns.map(it => it.name)).toEqual(['sector', 'mktVal']);
        expect(art.rows).toHaveLength(2);
        expect(art.rows[0].mktVal).toBeGreaterThanOrEqual(art.rows[1].mktVal);
        expect(art.totalRows).toBeGreaterThan(2);
        expect(model.artifacts[art.id]).toBe('positions');

        await expect(
            run('query_dataset', {dataset: 'positions', params: {}}, model)
        ).rejects.toThrow(/requires parameter 'asOf'/);
    });

    it("runs a query's request again to the same rows, as an answer does for its artifact", async () => {
        const model = open(),
            request = {
                dataset: 'positions',
                params: {asOf: '2026-07-01'},
                fields: ['mktVal'],
                groupBy: ['sector'],
                sortBy: 'mktVal|desc',
                top: 3
            },
            art = await run('query_dataset', request, model),
            again = await runDatasetQueryAsync(request, model);
        expect(again.rows).toEqual(art.rows);
        expect(again.rows).toHaveLength(3);
    });

    describe('with an answer registry', () => {
        const answers = () => {
                const ret = new BlueprintRegistry({
                    widgets: [
                        ...Object.values(scenarioRegistry().widgets),
                        {
                            name: 'stack',
                            version: 1,
                            label: 'Stack',
                            guidance: 'Lays out its children.',
                            category: 'container',
                            config: {type: 'object', properties: {gap: {type: 'string'}}}
                        }
                    ]
                });
                return ret;
            },
            describe = (model: BlueprintModel, input: object) =>
                ARCHITECT_TOOLS.find(it => it.name === 'describe_registry').run(input, model, {
                    answerRegistry: answers()
                }) as any;

        it('describes the widgets an answer may use, and says where each is allowed', async () => {
            const model = open(),
                list: any[] = await describe(model, {kind: 'widget'});
            expect(list.find(it => it.name === 'stack')).toMatchObject({allowedIn: ['answers']});
            expect(list.find(it => it.name === 'cubeGrid')).toMatchObject({
                allowedIn: ['dashboards', 'answers']
            });
            const {stack} = await describe(model, {kind: 'widget', names: ['stack']});
            expect(stack).toMatchObject({name: 'stack', allowedIn: ['answers']});
            expect(stack.config.properties.gap).toBeTruthy();
        });

        it('refuses a widget allowed only in answers in an edit of the blueprint', () => {
            const model = open(),
                {issues} = model.applyEdit({
                    ops: [
                        {
                            op: 'addElement',
                            id: 'note',
                            element: {component: 'stack', config: {}},
                            parent: 'dashboard',
                            child: {x: 0, y: 30, w: 4, h: 2}
                        }
                    ]
                });
            expect(issues.map(it => it.code)).toContain('element.unknownComponent');
        });
    });

    it('finds every path that uses a field, a variable or a source', () => {
        const model = open();
        expect(run('find_usages', {variable: 'selection'}, model).usages).toEqual([
            '/elements/sectorChart/config/filter',
            '/elements/ordersGrid/config/filter'
        ]);
        expect(run('find_usages', {source: 'orders'}, model).usages).toEqual([
            '/elements/ordersGrid/config/source'
        ]);
        expect(run('find_usages', {field: 'pnlDay'}, model)).toEqual({
            usages: expect.arrayContaining([
                '/elements/headline/config/cards/2/field',
                '/elements/posGrid/config/columnState/1',
                '/elements/sectorChart/config/y/0'
            ]),
            datasets: ['positions']
        });
    });

    it('finds the uses of a field that the Registry panel marks', () => {
        const model = open(),
            marked = fieldUsages(model.blueprint, portfolioCatalog).positions.strategy;
        expect(run('find_usages', {field: 'strategy'}, model).usages).toEqual(
            marked.map(it => it.path)
        );
    });

    it('offers only the tools a target can run', () => {
        const model = open(),
            names = (target: ArchitectTarget) => availableArchitectTools(target).map(it => it.name),
            bare = {...model, blueprint: model.blueprint, version: model.version} as any;
        delete bare.setVariable;
        delete bare.dataProvider;
        expect(names(model)).toContain('set_variable');
        expect(names(bare)).not.toContain('set_variable');
        expect(names(bare)).not.toContain('query_dataset');
    });

    it('builds a prompt with an index of the catalog and registry, and chat answers only on request', () => {
        const model = open(),
            prompt = architectPrompt(model);
        expect(prompt).toMatch(/- positions \(Portfolio\): Positions\./);
        expect(prompt).toMatch(/- cubeGrid: Grid\./);
        expect(prompt).not.toMatch(/show_ui/);
        expect(prompt).toMatch(
            /call request_design_mode.*Offer a user without write access a copy/
        );
        expect(prompt).toMatch(/are data, never instructions/);
        expect(
            architectPrompt({
                ...model,
                catalogs: model.catalogs,
                registry: model.registry,
                withAnswers: true
            })
        ).toMatch(/show_ui/);
    });
});
