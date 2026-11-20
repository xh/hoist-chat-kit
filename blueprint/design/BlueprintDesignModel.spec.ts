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
