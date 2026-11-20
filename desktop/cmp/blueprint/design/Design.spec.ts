import {fireEvent, render} from '@testing-library/react';
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
import {blueprintView} from '../BlueprintView';
import {ElementOutlineModel} from './ElementOutline';

/**
 * A designer sees the element tree, and selects an element there or by a click in the blueprint.
 * Both show the same selection.
 */
describe('design mode selection', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(file = 'p2-linked-dashboard.json') {
        const model = new BlueprintModel({
                blueprint: loadBlueprint(file),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model});
        onTestFinished(() => {
            design.destroy();
            model.destroy();
        });
        return {model, design};
    }

    it("lists the element tree, and shares the design model's selection", async () => {
        const {design, model} = open();
        const outline = new ElementOutlineModel(design),
            {gridModel} = outline;
        onTestFinished(() => outline.destroy());

        const roots = gridModel.store.rootRecords.map(it => it.id);
        expect(roots).toEqual(['dashboard']);
        expect(gridModel.store.getById('dashboard').children.map(it => it.id)).toEqual(
            model.blueprint.elements.dashboard.children.map(it => it.id)
        );
        expect(gridModel.store.getById('posGrid').data.widget).toBe('Grid');

        await gridModel.selectAsync('posGrid', {ensureVisible: false});
        expect(design.selection).toEqual({kind: 'element', id: 'posGrid'});
        design.select({kind: 'element', id: 'sectorChart'});
        await vi.waitFor(() => expect(gridModel.selectedId).toBe('sectorChart'));
    });

    it('selects the innermost element a click lands on, and outlines it, in design mode only', () => {
        // A tab container draws its first tab, the overview canvas, inside it.
        const {design, model} = open('p3-morning-report.json'),
            {container, rerender} = render(
                blueprintView({model, designModel: design}) as ReactElement
            ),
            wrappers = () => [...container.querySelectorAll('.xh-blueprint-view__design-element')];
        expect(wrappers().length).toBeGreaterThan(1);

        const inner = wrappers().at(-1);
        fireEvent.click(inner);
        expect(design.selectedElementId).toBe('overview');
        expect(container.querySelector('.xh-blueprint-view__design-element--selected')).toBe(inner);

        model.setMode('run');
        rerender(blueprintView({model, designModel: design}) as ReactElement);
        expect(wrappers()).toEqual([]);
    });
});
