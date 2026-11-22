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
import {blueprintInspector, BlueprintInspectorModel} from './BlueprintInspector';

/**
 * The Inspector: one frame for whatever is selected - its path, its id and what it reads, its
 * menu and its issues - over the editor for its kind.
 */
describe('BlueprintInspector', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open() {
        const model = new BlueprintModel({
                blueprint: loadBlueprint('p3-morning-report.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            inspector = new BlueprintInspectorModel(design);
        onTestFinished(() => {
            inspector.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, inspector};
    }

    it('names the selection, its path and what it reads, for every kind', () => {
        const {design, inspector} = open();
        design.select({kind: 'element', id: 'posGrid'});
        expect(inspector.breadcrumb).toEqual(['tabs', 'positions', 'posGrid']);
        expect(inspector.subtitle).toBe('Grid · reads positions, grouping, pnlFilter');
        design.select({kind: 'source', id: 'prices'});
        expect(inspector.breadcrumb).toEqual([]);
        expect(inspector.subtitle).toBe('dataset prices · reads symbol, priceStart, asOf');
        design.select({kind: 'variable', id: 'yearStart'});
        expect(inspector.subtitle).toBe('localDate · reads asOf');
        design.select({kind: 'preset', id: 'posViews'});
        expect(inspector.subtitle).toBe('Columns');
    });

    it("frames each kind's editor under one header, with a clickable path", async () => {
        const {design, model} = open(),
            {container} = render(blueprintInspector({designModel: design}) as ReactElement);
        design.select({kind: 'element', id: 'posGrid'});
        await vi.waitFor(() =>
            expect(container.querySelector('.xh-blueprint-inspector__id')?.textContent).toBe(
                'posGrid'
            )
        );
        // The editor's own header gives way to the frame's.
        expect(container.querySelector('.xh-blueprint-element-inspector__header')).toBeNull();
        fireEvent.click(
            [...container.querySelectorAll('.xh-blueprint-inspector__breadcrumb button')].find(
                it => it.textContent === 'positions'
            )
        );
        expect(design.selectedElementId).toBe('positions');
        design.select({kind: 'variable', id: 'asOf'});
        await vi.waitFor(() =>
            expect(container.querySelector('.xh-blueprint-inspector__id')?.textContent).toBe('asOf')
        );
        expect(container.querySelector('.xh-blueprint-variables-editor')).toBeTruthy();
        expect(model.history).toHaveLength(0);
    });

    it('renames from the header', () => {
        const {design, model, inspector} = open();
        design.select({kind: 'element', id: 'posGrid'});
        inspector.rename('book');
        expect(model.blueprint.elements).toHaveProperty('book');
        expect(design.selectedElementId).toBe('book');
    });
});
