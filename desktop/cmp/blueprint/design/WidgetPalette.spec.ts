import {fireEvent, render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
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

    it("dims the widgets the target won't take, with the reason, and outlines the target", () => {
        const {design, palette} = open(loadBlueprint('p3-morning-report.json'));
        design.selectSlot({parent: 'positions', slot: 'headerItems', of: 'posGrid'});
        const tiles = palette.groups.flatMap(it => it.widgets),
            tile = (name: string) => tiles.find(it => it.name === name);
        expect(tile('cubeGrid').refusal).toBe("posGrid's cell header takes inputs only.");
        expect(tile('select').refusal).toBeNull();
        expect(tiles.filter(it => !it.refusal).every(it => it.category === 'input')).toBe(true);
        expect(tile('cubeGrid').icon).toBe('grid');
        expect(tile('cubeGrid').title).toBeTruthy();
        expect(tile('cubeGrid').guidance.length).toBeGreaterThan(tile('cubeGrid').title.length);

        palette.setPointerOver(true);
        expect(design.showAddTarget).toBe(true);
        palette.setPointerOver(false);
        expect(design.showAddTarget).toBe(false);
    });

    it("focuses its search when the design asks for Add, as '/' does, and tells the host", async () => {
        const {design} = open(loadBlueprint('p2-linked-dashboard.json')),
            onRequestAdd = vi.fn();
        design.onRequestAdd = onRequestAdd;
        const {container} = render(widgetPalette({designModel: design}) as ReactElement);
        design.requestAdd();
        expect(onRequestAdd).toHaveBeenCalled();
        await vi.waitFor(() =>
            expect(document.activeElement).toBe(container.querySelector('input'))
        );
    });

    it('searches widgets by name, label and terms', () => {
        const {palette} = open(loadBlueprint('p2-linked-dashboard.json'));
        palette.search = 'pivot';
        expect(palette.groups.flatMap(it => it.widgets.map(w => w.name))).toEqual(['cubeGrid']);
    });

    it('adds a widget on a click, and selects it', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            {getByText} = render(widgetPalette({designModel: design}) as ReactElement);
        fireEvent.click(getByText('Chart'));
        expect(model.history.at(-1).description).toBe('Add Chart');
        expect(model.blueprint.elements[design.selectedElementId].component).toBe('chart');
    });

    it('offers to add a source over a dataset for a widget that needs one, then adds it', () => {
        const {model, design, palette} = open(undefined);
        palette.add('dashCanvas');
        palette.add('cubeGrid');
        expect(palette.needsSource).toBe('cubeGrid');
        expect(palette.datasetOptions.map(it => it.value)).toContain('positions');

        palette.addOver('positions');
        const {sources, variables, elements} = model.blueprint;
        expect(sources.positions).toEqual({dataset: 'positions', params: {asOf: {$var: 'asOf'}}});
        expect(variables.asOf).toMatchObject({
            type: 'localDate',
            setBy: 'prompt',
            default: {resolver: 'today'}
        });
        expect(elements[design.selectedElementId]).toMatchObject({
            component: 'cubeGrid',
            config: {source: 'positions'}
        });
        expect(palette.needsSource).toBeNull();
        expect(palette.message).toBeNull();
    });

    it('adds a widget dropped on a canvas where it fell, and selects it', () => {
        const {model, design, palette} = open(loadBlueprint('p2-linked-dashboard.json'));
        palette.addAt('chart', 'dashboard', {child: {x: 0, y: 14, w: 4, h: 6}, siblings: []});
        const id = design.selectedElementId;
        expect(model.blueprint.elements[id].component).toBe('chart');
        expect(model.blueprint.elements.dashboard.children.at(-1)).toEqual({
            id,
            x: 0,
            y: 14,
            w: 4,
            h: 6
        });
    });

    it('says where a click adds a widget', () => {
        const {design, palette} = open(loadBlueprint('p3-morning-report.json'));
        expect(palette.target).toBe('Adds into tabs');
        design.select({kind: 'element', id: 'overview'});
        expect(palette.target).toBe('Adds into overview');
        design.select({kind: 'element', id: 'sectorChart'});
        expect(palette.target).toBe('Adds after Day P&L by Sector, in overview');
        design.selectSlot({parent: 'positions', slot: 'headerItems', of: 'posGrid'});
        expect(palette.target).toBe("Adds into posGrid's cell header");
        expect(open(undefined).palette.target).toBe('Adds as the root');
    });

    it('says why a widget or its source was not added', () => {
        const {palette} = open(undefined);
        palette.add('dashCanvas');
        palette.add('chart');
        expect(palette.needsSource).toBe('chart');
        palette.addOver('nope');
        expect(palette.message).toBe("There is no dataset 'nope'.");
    });
});
