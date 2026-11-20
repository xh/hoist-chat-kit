import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
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
import {variablesEditor, VariableEditorModel} from './VariablesEditor';

/**
 * A designer adds, renames, removes and declares a blueprint's variables: type, label, who sets
 * each, its default and its options. Each change is one edit.
 */
describe('VariablesEditor', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(select = 'symbol') {
        const model = new BlueprintModel({
                blueprint: loadBlueprint('p3-morning-report.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            editor = new VariableEditorModel(design);
        if (select) design.select({kind: 'variable', id: select});
        onTestFinished(() => {
            editor.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, editor};
    }

    const decl = (m: BlueprintModel, name: string) => m.blueprint.variables[name];

    it('lists the variables, and adds, renames and removes one', () => {
        const {model, design, editor} = open(null);
        expect(editor.variableOptions.map(it => it.value)).toContain('symbol');
        expect(editor.name).toBeNull();

        editor.add();
        expect(editor.name).toBe('variable1');
        editor.rename('ticker');
        expect(decl(model, 'ticker')).toBeDefined();
        expect(design.selection).toEqual({kind: 'variable', id: 'ticker'});
        editor.remove();
        expect(model.blueprint.variables).not.toHaveProperty('ticker');
        expect(editor.name).toBeNull();
    });

    it('keeps a variable that something reads, and says why', () => {
        const {model, editor} = open('grouping');
        editor.remove();
        expect(decl(model, 'grouping')).toBeDefined();
        expect(editor.issuesFor('').length).toBeGreaterThan(0);
    });

    it('offers the built-in types, the app types, and lists of each but filter', () => {
        const {editor} = open();
        expect(editor.typeOptions).toEqual(
            expect.arrayContaining(['string', 'localDate', 'filter', 'fund', 'string[]', 'fund[]'])
        );
        expect(editor.typeOptions).not.toContain('filter[]');
    });

    it('offers each widget value and output a variable can be set by', () => {
        const {editor} = open();
        const labels = editor.writerOptions.map(it => it.label);
        expect(labels).toEqual(
            expect.arrayContaining(['groupChooser', 'posGrid › selection', 'posGrid › selected'])
        );
        expect(editor.needsField({element: 'posGrid', output: 'selected'})).toBe(true);
        expect(editor.needsField({element: 'posGrid', output: 'selection'})).toBe(false);
    });

    it('switches who sets a variable, with what each needs, in one edit', () => {
        const {model, editor} = open('symbol');
        expect(editor.setByKind).toBe('widgets');

        editor.setSetByKind('resolver');
        expect(decl(model, 'symbol')).toMatchObject({
            setBy: 'resolver',
            compute: {resolver: expect.any(String)}
        });
        editor.setSetByKind('prompt');
        expect(decl(model, 'symbol').setBy).toBe('prompt');
        expect(decl(model, 'symbol')).not.toHaveProperty('compute');
    });

    it("gives a literal default an editor for the variable's type", () => {
        const {editor} = open();
        expect(editor.valueSchema('string')).toEqual({type: 'string'});
        expect(editor.valueSchema('int')).toEqual({type: 'integer'});
        expect(editor.valueSchema('fund')).toEqual({type: 'string'});
        expect(editor.valueSchema('string[]')).toEqual({type: 'array', items: {type: 'string'}});
    });

    it("starts a literal default at the variable's first option, or with no value", () => {
        const {design, editor} = open('symbol');
        expect(editor.startValue()).toBeNull();
        design.setVariableDecl('symbol', 'options', {values: ['AAPL', 'MSFT']});
        expect(editor.startValue()).toBe('AAPL');
    });

    it('shows a default that presets control, and badges it with the active preset', () => {
        const {design, editor} = open('fund');
        design.addPresetGroup('/variables/fund/default');
        design.select({kind: 'variable', id: 'fund'});
        expect(editor.values.default).toEqual({resolver: 'userFund'});
        expect(editor.badgeFor('default')).toBe('Preset: Default › Preset 1');
    });

    it('draws the declaration of the selected variable', () => {
        const {design} = open('priceStart'),
            {container} = render(variablesEditor({designModel: design}) as ReactElement),
            labels = [...container.querySelectorAll('.xh-blueprint-element-inspector__label')].map(
                it => it.textContent
            );
        expect(labels).toEqual(
            expect.arrayContaining(['Name', 'Type *', 'Label', 'Set by', 'Compute', 'Default'])
        );
        expect(container.textContent).not.toContain('No model found');
    });
});
