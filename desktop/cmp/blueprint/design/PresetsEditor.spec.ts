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
    bandsOf,
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../../../../test/blueprintFixtures';
import {presetsEditor, PresetsEditorModel} from './PresetsEditor';

/**
 * A designer makes groups of presets over the preset paths of a blueprint's widgets, and edits
 * each group: its label, the paths it controls, its presets and its default. Switching the active
 * preset here is what lets the inspector and the widgets fill it.
 */
describe('PresetsEditor', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(select = 'posViews') {
        const model = new BlueprintModel({
                blueprint: loadBlueprint('p3-morning-report.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            editor = new PresetsEditorModel(design);
        if (select) design.select({kind: 'preset', id: select});
        onTestFinished(() => {
            editor.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, editor};
    }

    it('adds a selector for the group in the header of the widget it controls, until it has one', () => {
        const {model, design, editor} = open();
        design.removeElement('posViewsSelector');
        expect(editor.hasSelector).toBe(false);

        editor.addSelector();
        const [id, el] = Object.entries(model.blueprint.elements).find(
            ([, it]) => it.component === 'presetSelector'
        );
        expect(el.config).toEqual({group: 'posViews', display: 'toggle'});
        const cell = model.blueprint.elements.positions.children.find(it => it.id === 'posGrid');
        expect(cell.headerItems).toEqual([{id}]);
        expect(editor.hasSelector).toBe(true);
        expect(model.issues.map(it => it.code)).not.toContain('preset.noSelector');
    });

    it("offers each widget's preset paths, and each variable's default, that no group controls yet", () => {
        const {editor} = open(),
            paths = editor.candidatePaths.map(it => it.value);
        expect(paths).toContain('/elements/posGrid/config/sortBy');
        expect(paths).not.toContain('/elements/posGrid/config/columnState');
        expect(editor.candidatePaths.find(it => it.value.endsWith('sortBy')).label).toBe(
            'posGrid › Sort by'
        );
        expect(editor.candidatePaths.find(it => it.value === '/variables/fund/default').label).toBe(
            'fund › Default'
        );
    });

    it("lists the group's paths and presets, and which preset is active", () => {
        const {model, editor} = open();
        expect(editor.controls.map(it => it.label)).toEqual(['posGrid › Column state']);
        expect(editor.items.map(it => [it.id, it.label, it.isActive])).toEqual([
            ['pnl', 'P&L view', true],
            ['risk', 'Risk view', false]
        ]);
        editor.activate('risk');
        expect(model.getActivePreset('posViews')).toBe('risk');
        expect(editor.items[1].isActive).toBe(true);
    });

    it("makes a group over a path the widget requires, such as a chart's type", () => {
        const {model, design, editor} = open(null);
        editor.addGroup('/elements/sectorChart/config/type');
        expect(editor.issues).toEqual([]);
        expect(design.selection?.kind).toBe('preset');
        expect(model.blueprint.elements.sectorChart.config).not.toHaveProperty('type');
        expect(model.effective.elements.sectorChart.config.type).toBe('column');
    });

    it('makes a group, and selects it', () => {
        const {model, design, editor} = open(null);
        editor.addGroup('/elements/posGrid/config/sortBy');
        expect(design.selection).toEqual({kind: 'preset', id: 'group1'});
        expect(model.blueprint.presets.group1.controls).toEqual([
            {path: '/elements/posGrid/config/sortBy'}
        ]);
    });

    it('draws the selected group', () => {
        const {design} = open(),
            {container} = render(presetsEditor({designModel: design}) as ReactElement),
            labels = [...container.querySelectorAll('.xh-blueprint-element-inspector__label')].map(
                it => it.textContent
            );
        expect(labels).toEqual(expect.arrayContaining(['Label', 'Default']));
        expect(bandsOf(container)).toEqual(['Group', 'Controls 1', 'Presets 2']);
        // The active preset is the one edits fill.
        expect(
            [...container.querySelectorAll('.xh-blueprint-element-inspector__editing')].map(
                it =>
                    it.closest('.xh-blueprint-element-inspector__tab').querySelector('input').value
            )
        ).toEqual(['P&L view']);
        expect(container.textContent).not.toContain('No model found');
        expect(
            [...container.querySelectorAll('.xh-blueprint-element-inspector__hint')].map(
                it => it.textContent
            )
        ).toContain('The preset a user starts on.');
    });
});
