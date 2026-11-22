import {fireEvent, render} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
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
import {BlueprintStructureModel} from './BlueprintStructure';
import {designHotkeys} from './impl/designHotkeys';

/**
 * Structure: a blueprint's elements as a tree with their slots, then its sources, variables and
 * preset groups, each counted. It shares the design model's selection.
 */
describe('BlueprintStructure', () => {
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
            structure = new BlueprintStructureModel(design);
        onTestFinished(() => {
            structure.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, structure};
    }

    const record = (structure: BlueprintStructureModel, id: string) =>
        structure.gridModel.store.getById(id);

    it("marks an element hovered from its row, as the canvas's hover does, and clears it on leave", () => {
        const {structure, design} = open(),
            row = (test: (data: any) => boolean) =>
                render(
                    (structure as any).renderRow(
                        structure.gridModel.store.allRecords.find(it => test(it.data))
                    )
                ).container.firstElementChild;
        const posGrid = row(it => it.kind === 'element' && it.name === 'posGrid');
        fireEvent.mouseEnter(posGrid);
        expect(design.hoveredId).toBe('posGrid');
        fireEvent.mouseLeave(posGrid);
        expect(design.hoveredId).toBeNull();
        // A row that is no element marks nothing.
        fireEvent.mouseEnter(row(it => it.kind === 'source'));
        expect(design.hoveredId).toBeNull();
    });

    it('classes each row by its type: category, container, slot or leaf, with no tree tint', () => {
        const {structure, model} = open(),
            {store} = structure.gridModel,
            classOf = (test: (data: any) => boolean) =>
                structure.rowClassOf(store.allRecords.find(it => test(it.data))),
            {elements} = model.blueprint,
            container = Object.keys(elements).find(id => elements[id].children?.length),
            leaf = Object.keys(elements).find(
                id => !model.registry.widgets[elements[id].component]?.children
            );
        expect(structure.gridModel.treeStyle).toBe('none');
        expect(structure.gridModel.stripeRows).toBe(false);
        expect(classOf(it => it.kind === 'section')).toBe('xh-blueprint-tree__row--category');
        expect(classOf(it => it.kind === 'element' && it.name === container)).toBe(
            'xh-blueprint-tree__row--container'
        );
        expect(classOf(it => it.kind === 'element' && it.name === leaf)).toBe(
            'xh-blueprint-tree__row--leaf'
        );
        expect(classOf(it => it.kind === 'source')).toBe('xh-blueprint-tree__row--leaf');
        expect(classOf(it => it.kind === 'slot')).toBe('xh-blueprint-tree__row--slot');
    });

    it('lists elements, sources, variables and presets, each with its count', () => {
        const {structure} = open(),
            sections = structure.gridModel.store.rootRecords;
        expect(sections.map(it => [it.data.name, it.data.count])).toEqual([
            ['Elements', 18],
            ['Sources', 3],
            ['Variables', 8],
            ['Presets', 1]
        ]);
        expect(record(structure, 'source:positions').data.label).toBe('positions · 7 widgets');
        expect(record(structure, 'preset:posViews').data.label).toBe('Columns');
    });

    it('lists a canvas view between its canvas and its widget, only when it has settings of its own', async () => {
        const {structure, design} = open(),
            view = record(structure, 'view:posGrid');
        // posGrid's cell holds header items, so its view has settings. Plain cells do not.
        expect(view.data).toMatchObject({kind: 'view', name: 'posGrid', of: 'positions'});
        expect(view.parent.id).toBe('element:positions');
        expect(view.children.map(it => it.id)).toContain('element:posGrid');
        expect(record(structure, 'view:priceChart')).toBeFalsy();

        await structure.gridModel.selectAsync('view:posGrid');
        expect(design.selection).toEqual({kind: 'view', id: 'posGrid', of: 'positions'});
    });

    it('counts the widgets a source feeds, through joins too', () => {
        const model = new BlueprintModel({
                blueprint: loadBlueprint('p8-joined-positions.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            structure = new BlueprintStructureModel(design);
        onTestFinished(() => {
            structure.destroy();
            design.destroy();
            model.destroy();
        });
        expect(record(structure, 'source:funds').data.label).toBe('fundSummary · 1 widget');
    });

    it("puts a cell's header items under a Cell header node", () => {
        const {design, structure} = open(),
            header = record(structure, 'element:posViewsSelector').parent;
        expect(header.data.name).toBe('Cell header');
        // posGrid's view has settings of its own, so its header sits under the view.
        expect(header.parent.id).toBe('view:posGrid');
        // An empty slot shows only while a drag is on, or under the selected element.
        const empty = 'slot:positions|headerItems|priceChart',
            shown = () => structure.gridModel.store.records.some(it => it.id === empty);
        expect(shown()).toBe(false);
        structure.startDrag('groupChooser');
        expect(shown()).toBe(true);
        structure.endDrag();
        expect(shown()).toBe(false);
        design.select({kind: 'element', id: 'priceChart'});
        expect(shown()).toBe(true);
    });

    it('marks the elements on tabs not showing, as the canvas reports them', () => {
        const {design, structure} = open();
        expect(structure.isOffscreen('posGrid')).toBe(false);
        design.setCanvasTabs({tabs: 'overview'}, {});
        expect(structure.isOffscreen('posGrid')).toBe(true);
        expect(structure.isOffscreen('positions')).toBe(true);
        expect(structure.isOffscreen('sectorChart')).toBe(false);
        expect(structure.isOffscreen('tabs')).toBe(false);

        // A dash container's views behind another in their stack.
        design.setCanvasTabs({tabs: 'positions'}, {positions: ['priceChart']});
        expect(structure.isOffscreen('priceChart')).toBe(true);
        expect(structure.isOffscreen('posGrid')).toBe(false);

        // The canvas reports every container at once, so one gone takes its entry with it.
        design.setCanvasTabs({tabs: 'positions'}, {});
        expect(structure.isOffscreen('priceChart')).toBe(false);
        design.setCanvasTabs({}, {});
        expect(structure.isOffscreen('posGrid')).toBe(false);
    });

    it('filters to the rows whose id matches, keeping their ancestors', () => {
        const {structure} = open();
        structure.filterText = 'price';
        const leaves = structure.gridModel.store.records
            .filter(it => it.data.kind !== 'section' && it.data.kind !== 'slot')
            .filter(it => it.data.name.toLowerCase().includes('price'))
            .map(it => it.data.name);
        expect(leaves.sort()).toEqual(['priceChart', 'priceStart', 'prices']);
        expect(structure.gridModel.store.records.some(it => it.data.name === 'posGrid')).toBe(
            false
        );
    });

    it("shares the design model's selection, and selects a slot as a place to add", async () => {
        const {design, structure} = open();
        await structure.gridModel.selectAsync('variable:asOf', {ensureVisible: false});
        expect(design.selection).toEqual({kind: 'variable', id: 'asOf'});
        design.select({kind: 'source', id: 'prices'});
        await vi.waitFor(() => expect(structure.gridModel.selectedId).toBe('source:prices'));

        await structure.gridModel.selectAsync('slot:positions|headerItems|posGrid', {
            ensureVisible: false
        });
        expect(design.selectedElementId).toBe('posGrid');
        expect(design.addTarget).toEqual({parent: 'positions', slot: 'headerItems', of: 'posGrid'});
    });

    it('clears the selection on a section row, so Del never removes what the tree does not show', async () => {
        const {model, design, structure} = open();
        design.select({kind: 'element', id: 'posGrid'});
        await structure.gridModel.selectAsync('section:source', {ensureVisible: false});
        expect(design.selection).toBeNull();
        const del = designHotkeys(design, {arrows: false}).find(it => it.combo === 'del');
        del.onKeyDown({target: null, preventDefault: () => {}} as any);
        expect(model.blueprint.elements).toHaveProperty('posGrid');
    });

    it('deletes a selected variable with Del too, and refuses one that something reads', async () => {
        const {model, design} = open(),
            del = designHotkeys(design, {arrows: false}).find(it => it.combo === 'del'),
            press = () => del.onKeyDown({target: null, preventDefault: () => {}} as any),
            {id} = design.addVariable();
        design.select({kind: 'variable', id});
        press();
        await vi.waitFor(() => expect(model.blueprint.variables).not.toHaveProperty(id));
        const toast = vi.spyOn(XH, 'dangerToast').mockReturnValue(null);
        onTestFinished(() => toast.mockRestore());
        design.select({kind: 'variable', id: 'asOf'});
        press();
        await vi.waitFor(() => expect(toast).toHaveBeenCalled());
        expect(model.blueprint.variables).toHaveProperty('asOf');
    });

    it('offers a menu of rename, duplicate, move, add and delete for an element', () => {
        const {structure} = open(),
            texts = structure
                .menuFor(record(structure, 'element:posGrid'))
                .map((it: any) => it.text ?? it);
        expect(texts).toEqual(['Rename…', 'Duplicate', 'Move to', 'Add child', '-', 'Delete']);
    });

    it('says why a drag cannot drop before the drop, checking each target once per drag', () => {
        const {model, design, structure} = open(),
            check = vi.spyOn(design, 'addRefusal');
        structure.startDrag('posGrid');
        const header = 'slot:positions|headerItems|priceChart',
            refused = structure.dropVerdict(header, 0.5);
        expect(refused.reason).toBe("priceChart's cell header takes inputs only.");
        structure.dropVerdict(header, 0.4);
        expect(check).toHaveBeenCalledTimes(1);
        structure.drop(header, 0.5);
        expect(model.history).toHaveLength(0);
        structure.endDrag();

        structure.startDrag('priceChart');
        expect(structure.dropVerdict('element:groupChooser', 0.1)).toEqual({where: 'before'});
        structure.drop('element:groupChooser', 0.1);
        const ids = model.blueprint.elements.positions.children.map(it => it.id);
        expect(ids.indexOf('priceChart')).toBe(ids.indexOf('groupChooser') - 1);
        expect(structure.dropVerdict('section:source', 0.5)).toBeNull();
        structure.endDrag();
    });
});
