import {fireEvent, render} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    BlueprintDesignModel,
    BlueprintModel,
    FakeBlueprintDataProvider
} from '../../../../blueprint';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../../../../test/blueprintFixtures';
import {sourcesEditor, SourceEditorModel} from './SourcesEditor';

/**
 * A designer adds, renames and removes a blueprint's sources, and declares each: its dataset, its
 * parameters bound to variables, its filter, how its fields show, and instances of its
 * parameterized fields. Each change is one edit.
 */
describe('SourcesEditor', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(select = 'positions') {
        const model = new BlueprintModel({
                blueprint: loadBlueprint('p3-morning-report.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            editor = new SourceEditorModel(design);
        if (select) design.select({kind: 'source', id: select});
        onTestFinished(() => {
            editor.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, editor};
    }

    it('adds a source over the first dataset it can bind, and renames and removes it', () => {
        const {model, editor} = open(null);
        editor.add();
        expect(editor.name).toBe('positions1');
        editor.rename('book');
        expect(model.blueprint.sources).toHaveProperty('book');
        editor.remove();
        expect(model.blueprint.sources).not.toHaveProperty('book');
    });

    describe('joins', () => {
        it("joins another dataset source on the key fields they share, and shows each field's mode", () => {
            const {model, editor} = open();
            expect(editor.joinSourceOptions).toEqual(['orders', 'prices']);
            editor.addJoin('prices');
            expect(model.blueprint.sources.positions.joins).toEqual([
                {source: 'prices', on: {symbol: 'symbol'}, fields: []}
            ]);
            editor.setJoin(0, {fields: ['close', 'volume'], as: {close: 'lastClose'}});
            expect(editor.joinModes(0)).toEqual([
                {name: 'lastClose', field: 'close', mode: 'keyed', reduce: true},
                {name: 'volume', field: 'volume', mode: 'keyed', reduce: true}
            ]);
            expect(editor.joinFieldOptions(0).map(it => it.value)).toContain('high');
            editor.removeJoin(0);
            expect(model.blueprint.sources.positions.joins).toBeUndefined();
        });

        it('lists each join as a row, opened on its page, and removes it on Delete', async () => {
            const {model, design} = open();
            design.blueprintModel.applyEdit({
                ops: [
                    {
                        op: 'set',
                        path: '/sources/positions/joins',
                        value: [{source: 'prices', on: {symbol: 'symbol'}, fields: ['close']}]
                    }
                ]
            });
            const {container} = render(sourcesEditor({designModel: design}) as ReactElement),
                row = () => container.querySelector('[data-row-key="prices"]'),
                page = () =>
                    container.querySelector<HTMLElement>('.xh-blueprint-element-inspector__page');
            expect(row().textContent).toContain('on symbol');
            expect(row().textContent).toContain('1 field');
            // Its picker sits in the list's own Add row, inside the frame.
            const adds = [...container.querySelectorAll('.xh-sortable-list__add')].map(
                it => it.textContent
            );
            expect(adds).toEqual(
                expect.arrayContaining([
                    expect.stringContaining('Join a source…'),
                    expect.stringContaining('Add an instance of…')
                ])
            );
            fireEvent.click(row().querySelector('[aria-label="All settings of prices"]'));
            expect(page().textContent).toContain('1 of 1');
            expect(page().textContent).toContain('Fields');
            fireEvent.keyDown(page(), {key: 'Escape'});
            expect(page()).toBeNull();
            // Enter on the row opens the page, which takes focus once the key is done.
            fireEvent.keyDown(row(), {key: 'Enter'});
            await vi.waitFor(() => expect(page().contains(document.activeElement)).toBe(true));
            fireEvent.keyDown(page(), {key: 'Escape'});
            // Leaving it returns focus to its row.
            await vi.waitFor(() => expect(document.activeElement).toBe(row()));
            fireEvent.keyDown(row(), {key: 'Delete'});
            expect(model.blueprint.sources.positions.joins).toBeUndefined();
        });

        it('pairs only dimensions of the same type', () => {
            const {editor} = open();
            editor.addJoin('prices');
            expect(editor.onOptions(0, 'symbol')).toEqual([{value: 'symbol', label: 'Symbol'}]);
        });

        it('removes the joins that name a source it removes', () => {
            const {model, design, editor} = open(null);
            editor.add();
            design.select({kind: 'source', id: 'positions'});
            editor.addJoin('positions1');
            expect(model.blueprint.sources.positions.joins).toHaveLength(1);
            expect(design.removeSource('positions1').issues).toEqual([]);
            expect(model.blueprint.sources.positions.joins).toBeUndefined();
        });
    });

    it('offers, for each parameter, the variables of its type', () => {
        const {editor} = open();
        expect(editor.paramVariables('localDate')).toEqual(
            expect.arrayContaining(['asOf', 'priceStart', 'yearStart'])
        );
        expect(editor.paramVariables('toolbox.fund')).toEqual(['fund']);
    });

    it('changes the dataset with its required parameters bound again, in one edit', async () => {
        const {model, editor} = open(),
            confirm = vi.spyOn(XH, 'confirm').mockResolvedValueOnce(false);
        onTestFinished(() => confirm.mockRestore());

        await editor.setDatasetAsync('orders');
        expect(model.blueprint.sources.positions.dataset).toBe('positions');
        expect(confirm.mock.calls[0][0].message).toMatch(/posGrid/);
        expect(editor.issuesFor('dataset')[0].message).toMatch(/Change or remove .*posGrid/);

        confirm.mockResolvedValueOnce(true);
        await editor.setDatasetAsync('orders');
        expect(model.blueprint.sources.positions.dataset).toBe('orders');
        expect(model.blueprint.elements).not.toHaveProperty('posGrid');
        model.undo();

        editor.add();
        await editor.setDatasetAsync('orders');
        expect(model.blueprint.sources).not.toHaveProperty('positions1');
        expect(model.blueprint.sources.orders1).toEqual({
            dataset: 'orders',
            params: {asOf: {$var: 'asOf'}}
        });
        expect(model.history.at(-1).description).toMatch(/^Source positions1: /);
    });

    it("offers a dataset's parameterized fields for instances", () => {
        const {editor} = open();
        const fields = editor.parameterizedFields.map(it => it.value),
            count = () =>
                Object.values(editor.values.fields ?? {}).filter(
                    it => (it as any).field === fields[0]
                ).length,
            before = count();
        expect(fields.length).toBeGreaterThan(0);
        editor.addInstance(fields[0]);
        expect(count()).toBe(before + 1);

        editor.addInstance('return');
        const added = Object.values(editor.values.fields).at(-1) as any;
        expect(added).toEqual({
            field: 'return',
            params: {start: {$var: 'asOf'}, end: {$var: 'asOf'}}
        });
    });

    it('draws the declaration of the selected source', () => {
        const {design} = open(),
            {container} = render(sourcesEditor({designModel: design}) as ReactElement),
            labels = [...container.querySelectorAll('.xh-blueprint-element-inspector__label')].map(
                it => it.textContent
            );
        expect(labels).toEqual(
            expect.arrayContaining(['Name', 'Dataset', 'Parameters', 'Filter', 'Fields'])
        );
        expect(container.textContent).not.toContain('No model found');
        expect(
            [...container.querySelectorAll('.xh-blueprint-element-inspector__hint')].map(
                it => it.textContent
            )
        ).toContain('Fields from another source, matched on shared keys.');
    });
});
