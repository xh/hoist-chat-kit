import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {catalogFor, loadBlueprint, scenarioRegistry} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import {BlueprintModel} from './BlueprintModel';
import {FakeBlueprintDataProvider} from './FakeBlueprintDataProvider';
import {ARCHITECT_TOOLS} from './architect/ArchitectTools';

/**
 * Undo and redo are edits too: each applies as a new edit, with a version and a history entry, so
 * versions only go up, the history only grows, and mode, access and validation apply as for any
 * edit. The stacks are linear, and a new edit clears the redo stack.
 */
describe('undo and redo', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(file: string) {
        const catalog = catalogFor(file),
            ret = new BlueprintModel({
                blueprint: loadBlueprint(file),
                catalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog}),
                mode: 'design',
                access: 'write'
            });
        onTestFinished(() => ret.destroy());
        return ret;
    }

    const titled = (model: BlueprintModel, title: string, description = `Title ${title}`) =>
        model.applyEdit({
            description,
            ops: [{op: 'set', path: '/elements/posGrid/config/title', value: title}]
        });

    it.each([
        ['p2-linked-dashboard.json', 'p4-edit.json'],
        ['p3-morning-report.json', 'p3-edit-prompt-8.json'],
        ['w2-two-cities.json', 'w3-add-chicago.json']
    ])('undoes and redoes the scenario edit to %s', (file, editFile) => {
        const model = open(file),
            original: Blueprint = model.blueprint,
            {ops, description} = loadBlueprint(editFile) as any;
        expect(model.applyEdit({ops, description}).issues.filter(isError)).toEqual([]);
        const edited = model.blueprint;
        expect(model.undoDescription).toBe(description ?? 'Edit');

        expect(model.undo().issues.filter(isError)).toEqual([]);
        expect(model.blueprint).toEqual(original);
        expect(model.redo().issues.filter(isError)).toEqual([]);
        expect(model.blueprint).toEqual(edited);
        expect(model.version).toBe(4);
        expect(model.history.map(it => it.description)).toEqual([
            description,
            `Undo: ${description}`,
            `Redo: ${description}`
        ]);
    });

    it('walks back through edits, and forward again, as a linear stack', () => {
        const model = open('p2-linked-dashboard.json');
        titled(model, 'A');
        titled(model, 'B');
        expect([model.canUndo, model.canRedo]).toEqual([true, false]);

        model.undo();
        expect(model.blueprint.elements.posGrid.config.title).toBe('A');
        expect(model.redoDescription).toBe('Title B');
        model.undo();
        expect(model.blueprint.elements.posGrid.config.title).toBeUndefined();
        expect([model.canUndo, model.canRedo]).toEqual([false, true]);
        expect(model.undo().issues).toMatchObject([{code: 'edit.nothingToUndo'}]);

        model.redo();
        model.redo();
        expect(model.blueprint.elements.posGrid.config.title).toBe('B');
        expect(model.canRedo).toBe(false);
    });

    it('clears the redo stack with a new edit', () => {
        const model = open('p2-linked-dashboard.json');
        titled(model, 'A');
        model.undo();
        expect(model.canRedo).toBe(true);
        titled(model, 'C');
        expect(model.canRedo).toBe(false);
        expect(model.redo().issues).toMatchObject([{code: 'edit.nothingToRedo'}]);
    });

    it('refuses to undo in run mode, as any edit, and keeps the stacks', () => {
        const model = open('p2-linked-dashboard.json');
        titled(model, 'A');
        model.setMode('run');
        expect(model.undo().issues).toMatchObject([{code: 'edit.notAllowed'}]);
        expect(model.blueprint.elements.posGrid.config.title).toBe('A');
        expect(model.canUndo).toBe(true);
    });

    it('keeps the last 50 edits to undo', () => {
        const model = open('p2-linked-dashboard.json');
        for (let i = 1; i <= 55; i++) titled(model, `T${i}`);
        let undone = 0;
        while (model.canUndo) {
            model.undo();
            undone++;
        }
        expect(undone).toBe(50);
        expect(model.blueprint.elements.posGrid.config.title).toBe('T5');
    });

    it('undoes an edit the Architect made through its tool', () => {
        const model = open('p2-linked-dashboard.json'),
            original = model.blueprint;
        ARCHITECT_TOOLS.find(it => it.name === 'edit_blueprint').run(
            {
                base: model.version,
                description: 'Group by sector',
                ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['sector']}]
            },
            model
        );
        expect(model.undoDescription).toBe('Group by sector');
        model.undo();
        expect(model.blueprint).toEqual(original);
    });

    it('starts over when another blueprint opens, or the model clears', () => {
        const model = open('p2-linked-dashboard.json');
        titled(model, 'A');
        model.setBlueprint(loadBlueprint('p1-one-grid.json'));
        expect([model.canUndo, model.canRedo]).toEqual([false, false]);
        model.clear();
        expect(model.canUndo).toBe(false);
    });
});

const isError = (it: {severity: string}) => it.severity === 'error';
