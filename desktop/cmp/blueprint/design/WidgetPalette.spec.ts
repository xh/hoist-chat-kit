import {fireEvent, render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {
    type Blueprint,
    BlueprintDesignModel,
    BlueprintModel,
    FakeBlueprintDataProvider
} from '../../../../blueprint';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../../../../test/blueprintFixtures';
import {widgetPalette, WidgetPaletteModel} from './WidgetPalette';

/** A designer adds a widget from the registry's palette, and the new element is selected. */
describe('WidgetPalette', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(blueprint: Blueprint) {
        const model = new BlueprintModel({
                blueprint,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            palette = new WidgetPaletteModel(design);
        onTestFinished(() => {
            palette.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, palette};
    }

    it('lists the widgets a designer can add by category, without reserved ones', () => {
        const {palette} = open(loadBlueprint('p2-linked-dashboard.json')),
            names = palette.groups.flatMap(it => it.widgets.map(w => w.name));
        expect(palette.groups.map(it => it.category)).toEqual(
            expect.arrayContaining(['container', 'data', 'input', 'action'])
        );
        expect(names).toEqual(expect.arrayContaining(['cubeGrid', 'chart', 'dashCanvas']));
        expect(names).not.toContain('placeholder');
        expect(names).not.toContain('fallback');
    });

    it('adds a widget on a click, and selects it', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            {getByText} = render(widgetPalette({designModel: design}) as ReactElement);
        fireEvent.click(getByText('Chart'));
        expect(model.history.at(-1).description).toBe('Add Chart');
        expect(model.blueprint.elements[design.selectedElementId].component).toBe('chart');
    });

    it('says where a click adds a widget', () => {
        const {design, palette} = open(loadBlueprint('p3-morning-report.json'));
        expect(palette.target).toBe('Adds into tabs');
        design.select({kind: 'element', id: 'overview'});
        expect(palette.target).toBe('Adds into overview');
        design.select({kind: 'element', id: 'sectorChart'});
        expect(palette.target).toBe('Adds after Day P&L by Sector, in overview');
        expect(open(undefined).palette.target).toBe('Adds as the root');
    });

    it('says why a widget was not added', () => {
        const {palette} = open(undefined);
        palette.add('dashCanvas');
        palette.add('cubeGrid');
        expect(palette.message).toBe('Add a source for the Grid to read first.');
        palette.add('chart');
        expect(palette.message).toMatch(/Add a source/);
    });
});
