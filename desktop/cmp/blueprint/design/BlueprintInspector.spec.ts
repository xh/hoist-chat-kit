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
import {blueprintInspector, BlueprintInspectorModel, foldCrumbs} from './BlueprintInspector';

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
        expect(inspector.subtitle).toBe('Local date · computed by yearStart · reads asOf');
        design.select({kind: 'variable', id: 'asOf'});
        expect(inspector.subtitle).toBe('Local date · prompt');
        design.select({kind: 'variable', id: 'grouping'});
        expect(inspector.subtitle).toBe('List of text · set by groupChooser');
        design.select({kind: 'preset', id: 'posViews'});
        expect(inspector.subtitle).toBe('Columns');
    });

    it('shows the wiring of each kind first, each chip naming its target', () => {
        const {design, inspector} = open(),
            rows = () =>
                Object.fromEntries(
                    inspector.wiringRows.map(it => [
                        it.label,
                        it.chips?.map(c => c.text) ?? it.text
                    ])
                );
        design.select({kind: 'element', id: 'posGrid'});
        expect(rows()).toEqual({
            Reads: ['positions', 'grouping', 'pnlFilter'],
            Sets: ['selection', 'symbol'],
            Presets: ['posViews']
        });
        design.select({kind: 'variable', id: 'asOf'});
        expect(rows()['Set by']).toEqual(['prompt']);
        expect([...rows()['Read by']].sort()).toEqual(
            ['orders', 'positions', 'prices.end', 'priceStart', 'reportActions', 'yearStart'].sort()
        );
        expect(typeof rows().Now).toBe('string');
        design.select({kind: 'source', id: 'prices'});
        expect(rows()).toMatchObject({'Read by': ['priceChart'], Waits: ['symbol']});
        design.select({kind: 'preset', id: 'posViews'});
        expect(rows()).toEqual({
            Controls: ['posGrid · columnState'],
            'Shown by': ['posViewsSelector']
        });

        // A chip selects what it names.
        inspector.wiringRows[0].chips[0].select();
        expect(design.selectedElementId).toBe('posGrid');
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

    it("ends the path with the selection's kind, after an icon on every step", async () => {
        const {design} = open(),
            {container} = render(blueprintInspector({designModel: design}) as ReactElement);
        design.select({kind: 'element', id: 'posGrid'});
        const current = await vi.waitFor(() => {
            const it = container.querySelector('.xh-blueprint-inspector__crumb--current');
            expect(it).toBeTruthy();
            return it;
        });
        expect(current.textContent).toBe('posGridGrid');
        expect(current.querySelector('.xh-blueprint-inspector__crumb-kind').textContent).toBe(
            'Grid'
        );
        expect(
            container.querySelectorAll('.xh-blueprint-inspector__breadcrumb svg').length
        ).toBeGreaterThanOrEqual(5);
    });

    it('folds the middle of a path that does not fit, keeping its first and last steps', () => {
        // Widths of three steps, with 19px separators and a 28px fold.
        expect(foldCrumbs([60, 95, 111], 260)).toEqual({shown: [0, 2], hidden: [1]});
        expect(foldCrumbs([60, 95, 111], 400)).toEqual({shown: [0, 1, 2], hidden: []});
        // Unmeasured, it shows the whole path.
        expect(foldCrumbs([60, 95, 111], 0)).toEqual({shown: [0, 1, 2], hidden: []});
        // The steps nearest the selection come back first.
        expect(foldCrumbs([60, 80, 80, 80, 100], 330)).toEqual({
            shown: [0, 3, 4],
            hidden: [1, 2]
        });
    });

    it('sums up the blueprint when nothing is selected', async () => {
        const {design} = open(),
            {container, getByText} = render(
                blueprintInspector({
                    designModel: design,
                    documentModel: {
                        document: {name: 'Morning report', description: 'P&L and risk'}
                    } as any
                }) as ReactElement
            );
        expect(getByText('Morning report')).toBeTruthy();
        expect(getByText('P&L and risk')).toBeTruthy();
        expect(container.textContent).toContain(
            '18 elements · 3 sources · 8 variables · 1 preset group'
        );
        expect(container.textContent).not.toMatch(/Select/);
        fireEvent.click(getByText('tabs'));
        expect(design.selectedElementId).toBe('tabs');
    });

    it('renames from the header, and not once Escape cancels it', () => {
        const {design, model, inspector} = open();
        design.select({kind: 'element', id: 'posGrid'});
        inspector.setRenaming(true);
        inspector.setRenaming(false);
        // The input commits as it blurs on its way out.
        inspector.rename('nope');
        expect(model.blueprint.elements).not.toHaveProperty('nope');
        inspector.setRenaming(true);
        inspector.rename('book');
        expect(model.blueprint.elements).toHaveProperty('book');
        expect(design.selectedElementId).toBe('book');
    });
});
