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

    it("puts a cell's header items under a Cell header node", () => {
        const {design, structure} = open(),
            header = record(structure, 'element:posViewsSelector').parent;
        expect(header.data.name).toBe('Cell header');
        expect(header.parent.id).toBe('element:posGrid');
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
        design.setActiveTab('tabs', 'overview');
        expect(structure.isOffscreen('posGrid')).toBe(true);
        expect(structure.isOffscreen('positions')).toBe(true);
        expect(structure.isOffscreen('sectorChart')).toBe(false);
        expect(structure.isOffscreen('tabs')).toBe(false);
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
