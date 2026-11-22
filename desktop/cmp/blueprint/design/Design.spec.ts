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
import {XH} from '@xh/hoist/core';
import {blueprintView} from '../BlueprintView';
import {cellElementAt} from '../impl/ElementHost';
import {BlueprintViewModel} from '../impl/BlueprintViewModel';
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

    it('lists what each slot holds under its parent, naming the slot', () => {
        const {design} = open('p3-morning-report.json');
        design.removeElement('posViewsSelector');
        const {id} = design.addPresetSelector('posViews'),
            outline = new ElementOutlineModel(design);
        onTestFinished(() => outline.destroy());
        const row = outline.gridModel.store.getById(id);
        expect(row.parent.id).toBe('positions');
        expect(row.data.widget).toBe('Preset selector · posGrid header');
    });

    it('moves an element dropped on another, into it or beside it by where the drop falls', () => {
        const {design, model} = open('p3-morning-report.json'),
            outline = new ElementOutlineModel(design);
        onTestFinished(() => outline.destroy());
        expect(outline.whereFor('positions', 0.5)).toBe('into');
        expect(outline.whereFor('posGrid', 0.2)).toBe('before');
        expect(outline.whereFor('posGrid', 0.8)).toBe('after');
        expect(outline.whereFor('positions', 0.1)).toBe('before');

        outline.drop('priceChart', 'groupChooser', 'before');
        const ids = model.blueprint.elements.positions.children.map(it => it.id);
        expect(ids.indexOf('priceChart')).toBe(ids.indexOf('groupChooser') - 1);
    });

    it('shows a refused move as a danger toast, whose Show selects the element it names', () => {
        const {design} = open('p3-morning-report.json'),
            outline = new ElementOutlineModel(design),
            toast = vi.spyOn(XH, 'dangerToast').mockReturnValue(null);
        onTestFinished(() => {
            outline.destroy();
            toast.mockRestore();
        });
        new BlueprintViewModel(design.blueprintModel, {designModel: design});
        outline.drop('positions', 'posGrid', 'into');
        const [spec] = toast.mock.calls[0] as any[];
        expect(spec.message).toMatch(/inside/);
        expect(spec.actionButtonProps.text).toBe('Show');
        // Long enough to reach for its action.
        expect(spec.timeout).toBe(8000);
        spec.actionButtonProps.onClick();
        expect(design.selectedElementId).toBe('positions');
    });

    it('activates the tab that holds a selected element', () => {
        const {design, model} = open('p3-morning-report.json'),
            view = new BlueprintViewModel(model, {designModel: design});
        onTestFinished(() => view.destroy());
        const tabs = view.getWidgetModel('tabs') as any,
            ordersTab = model.blueprint.elements.tabs.children.find(it =>
                JSON.stringify(model.blueprint.elements[it.id]).includes('ordersGrid')
            ).id;
        expect(tabs.tabContainerModel.activeTabId).not.toBe(ordersTab);
        design.select({kind: 'element', id: 'ordersGrid'});
        expect(tabs.tabContainerModel.activeTabId).toBe(ordersTab);
    });

    it('selects the element in a canvas cell from a click on its header, not the canvas', () => {
        const cell = document.createElement('div');
        cell.innerHTML =
            '<div class="xh-dash-tab"><div class="xh-panel-header"><span class="title">Day P&L</span>' +
            '<div data-blueprint-element="views"></div></div>' +
            '<div class="body"><div data-blueprint-element="sectorChart"></div></div></div>';
        const host = document.createElement('div');
        host.appendChild(cell);
        expect(cellElementAt(cell.querySelector('.title') as HTMLElement, host)).toBe(
            'sectorChart'
        );
        // A click outside any cell header is the host's own.
        expect(cellElementAt(cell.querySelector('.body') as HTMLElement, host)).toBeNull();
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

    it('hovers the innermost element under the pointer, with its name tag, as view state', async () => {
        const {design, model} = open('p3-morning-report.json'),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            inner = [...container.querySelectorAll('.xh-blueprint-view__design-element')].at(-1);
        fireEvent.mouseOver(inner);
        expect(design.hoveredId).toBe('overview');
        await vi.waitFor(() =>
            expect(container.querySelector('.xh-blueprint-view__design-element--hovered')).toBe(
                inner
            )
        );
        expect(inner.getAttribute('data-blueprint-tag')).toBe('overview · Dashboard');
        fireEvent.mouseLeave(inner);
        expect(design.hoveredId).toBeNull();
        expect(model.history).toHaveLength(0);
    });

    it("haloes what the Architect's latest edit touched", () => {
        const {design, model} = open('p3-morning-report.json'),
            view = new BlueprintViewModel(model, {designModel: design});
        onTestFinished(() => view.destroy());
        model.applyEdit({
            author: 'architect',
            ops: [{op: 'set', path: '/elements/posGrid/config/title', value: 'Book'}]
        });
        expect(view.haloIds).toEqual(['posGrid']);
        design.setConfig('sectorChart', '/title', 'Sectors');
        expect(view.haloIds).toEqual(['posGrid']);
    });
});
