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
import {wait} from '@xh/hoist/promise';
import {blueprintView} from '../BlueprintView';
import {cellElementAt} from '../impl/ElementHost';
import {BlueprintViewModel} from '../impl/BlueprintViewModel';
import {ElementOutlineModel} from './ElementOutline';
import {removeElementAsync, removePresetGroupAsync} from './impl/designActions';

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
        // Reported to the design model, for Structure to dim the other tabs' elements.
        expect(design.activeTabs.tabs).toBe(ordersTab);
    });

    it('brings the selection into view when the canvas mounts, as after the Map', () => {
        const {design, model} = open('p3-morning-report.json');
        design.select({kind: 'element', id: 'ordersGrid'});
        const view = new BlueprintViewModel(model, {designModel: design});
        onTestFinished(() => view.destroy());
        expect((view.getWidgetModel('tabs') as any).tabContainerModel.activeTabId).toBe('orders');
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

    it('removes a lone element at once with a toast to undo, and asks first when more goes', async () => {
        const {design, model} = open('p3-morning-report.json'),
            confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(false),
            toast = vi.spyOn(XH, 'toast').mockReturnValue(null);
        onTestFinished(() => {
            confirm.mockRestore();
            toast.mockRestore();
        });
        design.select({kind: 'element', id: 'sectorChart'});
        await removeElementAsync(design, 'sectorChart');
        expect(confirm).not.toHaveBeenCalled();
        expect(model.blueprint.elements).not.toHaveProperty('sectorChart');
        // The next sibling, else the one before.
        expect(design.selectedElementId).toBe('regionChart');
        await removeElementAsync(design, 'regionChart');
        expect(design.selectedElementId).toBe('headline');
        const [[first], [latest]] = toast.mock.calls as any[];
        expect(first.message).toBe('Removed sectorChart.');
        // An older toast undoes nothing once another edit came after it.
        const warning = vi.spyOn(XH, 'warningToast').mockReturnValue(null);
        onTestFinished(() => warning.mockRestore());
        first.actionButtonProps.onClick();
        expect(warning).toHaveBeenCalled();
        expect(model.blueprint.elements).not.toHaveProperty('regionChart');
        latest.actionButtonProps.onClick();
        expect(model.blueprint.elements).toHaveProperty('regionChart');

        await removeElementAsync(design, 'headline');
        expect(confirm.mock.calls[0][0].message).toMatch(
            /Remove headline, and the 4 elements in it\?/
        );
        expect(model.blueprint.elements).toHaveProperty('headline');
    });

    it('shows a toolbar on the selected element, whose parent button selects its parent', async () => {
        const {design, model} = open('p3-morning-report.json'),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement);
        design.select({kind: 'element', id: 'overview'});
        const toolbar = await vi.waitFor(() => {
            const it = container.querySelector('.xh-blueprint-selection-toolbar');
            expect(it).toBeTruthy();
            return it;
        });
        expect(toolbar.textContent).toContain('overview · Dashboard');
        expect(toolbar.querySelectorAll('button')).toHaveLength(5);
        fireEvent.click(toolbar.querySelector('button[title^="Select the parent"]'));
        expect(design.selectedElementId).toBe('tabs');
        // Focus goes back to the canvas, so the design keys keep working.
        await vi.waitFor(() =>
            expect(document.activeElement).toBe(
                container.querySelector('.xh-panel__content[tabindex]')
            )
        );
    });

    it('runs the design keys on the selection, but never from an input', () => {
        const {design, model} = open('p3-morning-report.json'),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            key = (target: Element, key: string, init: object = {}) =>
                fireEvent.keyDown(target, {key, ...init});
        design.select({kind: 'element', id: 'headline'});
        const canvas = container.querySelector('[data-blueprint-element="overview"]');
        key(canvas, ']');
        expect(design.selectedElementId).toBe('sectorChart');
        key(canvas, 'Escape');
        expect(design.selectedElementId).toBe('overview');
        key(canvas, 'Enter');
        expect(design.selectedElementId).toBe('reportActions');

        design.select({kind: 'element', id: 'sectorChart'});
        const y = () =>
            model.blueprint.elements.overview.children.find(it => it.id === 'sectorChart')
                .y as number;
        const before = y();
        key(canvas, 'ArrowDown');
        key(canvas, 'ArrowDown');
        key(canvas, 'ArrowUp');
        expect(y()).toBe(before + 1);
        expect(model.history).toHaveLength(1);
        key(canvas, 'z', {ctrlKey: true});
        expect(y()).toBe(before);

        const input = container.querySelector('.xh-blueprint-view__toolbar input');
        expect(input).toBeTruthy();
        key(input, 'Escape');
        expect(design.selectedElementId).toBe('sectorChart');
    });

    it("shows an empty dashboard in design mode, with the host's Add and Architect", async () => {
        const model = new BlueprintModel({
                blueprint: {
                    root: 'canvas',
                    elements: {canvas: {component: 'dashCanvas', children: []}}
                },
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            onAddWidget = vi.fn(),
            onAskArchitect = vi.fn();
        onTestFinished(() => {
            design.destroy();
            model.destroy();
        });
        const {getByText} = render(
            blueprintView({model, designModel: design, onAddWidget, onAskArchitect}) as ReactElement
        );
        expect(getByText('This dashboard is empty.')).toBeTruthy();
        fireEvent.click(getByText('Add a widget'));
        expect(design.selectedElementId).toBe('canvas');
        expect(onAddWidget).toHaveBeenCalledWith({parent: 'canvas', slot: 'children'});
        fireEvent.click(getByText('Ask the Architect'));
        expect(onAskArchitect).toHaveBeenCalled();
    });

    it('shows a source that failed to load in its widget, with Retry', async () => {
        let fail = true;
        const provider = new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
            load = provider.loadAsync.bind(provider);
        // Loads, rather than subscribes, so a load can fail.
        Object.assign(provider, {subscribe: undefined});
        provider.loadAsync = req => (fail ? Promise.reject(new Error('Server down')) : load(req));
        const model = new BlueprintModel({
            blueprint: loadBlueprint('p1-one-grid.json'),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: provider,
            mode: 'run'
        });
        onTestFinished(() => model.destroy());
        const {findByText, queryByText} = render(blueprintView({model}) as ReactElement);
        const retry = await findByText('Retry');
        expect(await findByText(/Could not load/)).toBeTruthy();
        fail = false;
        fireEvent.click(retry);
        await vi.waitFor(() => expect(queryByText('Retry')).toBeNull());
    });

    it('masks a data widget while its source loads, and names the values in play with no rows', async () => {
        let resolve: (it: {rows: any[]}) => void;
        const provider = new FakeBlueprintDataProvider({catalog: portfolioCatalog});
        Object.assign(provider, {subscribe: undefined});
        provider.loadAsync = () => new Promise(it => (resolve = it));
        const model = new BlueprintModel({
            blueprint: loadBlueprint('p1-one-grid.json'),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: provider,
            mode: 'run'
        });
        onTestFinished(() => model.destroy());
        const {container, findByText} = render(blueprintView({model}) as ReactElement);
        await vi.waitFor(() =>
            expect(container.querySelector('.xh-blueprint-view__data .xh-mask')).toBeTruthy()
        );
        resolve({rows: []});
        expect(await findByText(/^No rows for As of /)).toBeTruthy();
        expect(container.querySelector('.xh-blueprint-view__data .xh-mask')).toBeNull();
    });

    it("leaves a widget's own controls their keys: a grid, a button and a text input", async () => {
        const model = new BlueprintModel({
                blueprint: {
                    ...loadBlueprint('p1-one-grid.json'),
                    root: 'page',
                    variables: {
                        ...loadBlueprint('p1-one-grid.json').variables,
                        who: {type: 'string', setBy: {element: 'name'}}
                    },
                    elements: {
                        ...loadBlueprint('p1-one-grid.json').elements,
                        page: {
                            component: 'box',
                            config: {direction: 'column'},
                            children: [{id: 'buttons'}, {id: 'name'}, {id: 'posGrid'}]
                        },
                        buttons: {
                            component: 'buttonGroup',
                            config: {buttons: [{label: 'Go', action: {type: 'refresh'}}]}
                        },
                        name: {component: 'textInput', config: {label: 'Name'}}
                    }
                },
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
        const {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            removed = () => !model.blueprint.elements.posGrid;
        design.select({kind: 'element', id: 'posGrid'});
        // ag-Grid is not loaded here, so its frame stands in for a focused cell.
        const grid = await vi.waitFor(() => {
            const it = container.querySelector('[data-blueprint-element="posGrid"] .xh-grid > *');
            expect(it).toBeTruthy();
            return it;
        });
        fireEvent.keyDown(grid, {key: 'Backspace'});
        fireEvent.keyDown(grid, {key: 'ArrowDown'});
        fireEvent.keyDown(container.querySelector('.xh-blueprint-button-group button'), {
            key: 'Enter'
        });
        fireEvent.keyDown(container.querySelector('[data-blueprint-element="name"] input'), {
            key: 'Delete'
        });
        expect(removed()).toBe(false);
        expect(design.selectedElementId).toBe('posGrid');
        expect(model.history).toHaveLength(0);

        // From the design surface itself, they act.
        fireEvent.keyDown(container.querySelector('[data-blueprint-element="posGrid"]'), {
            key: 'Escape'
        });
        expect(design.selectedElementId).toBe('page');
    });

    it('refuses a resize into a neighbouring cell with a toast', () => {
        const {design, model} = open('p3-morning-report.json'),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            toast = vi.spyOn(XH, 'dangerToast').mockReturnValue(null);
        onTestFinished(() => toast.mockRestore());
        design.select({kind: 'element', id: 'sectorChart'});
        fireEvent.keyDown(container.querySelector('[data-blueprint-element="overview"]'), {
            key: 'ArrowRight',
            shiftKey: true
        });
        expect(model.history).toHaveLength(0);
        expect(toast).toHaveBeenCalled();
    });

    it('asks before removing a preset group that takes its selectors with it', async () => {
        const {design, model} = open('p3-morning-report.json'),
            confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(false);
        onTestFinished(() => confirm.mockRestore());
        await removePresetGroupAsync(design, 'posViews');
        expect(confirm.mock.calls[0][0].message).toMatch(/posViewsSelector/);
        expect(model.blueprint.presets).toHaveProperty('posViews');
    });

    it('returns focus to the canvas only once a toolbar action, such as a confirm, settles', async () => {
        let answer: (ok: boolean) => void;
        const {design, model} = open('p3-morning-report.json'),
            confirm = vi
                .spyOn(XH, 'confirm')
                .mockReturnValue(new Promise<boolean>(it => (answer = it))),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            surface = () => container.querySelector('.xh-panel__content[tabindex]');
        onTestFinished(() => confirm.mockRestore());
        design.select({kind: 'element', id: 'overview'});
        const remove = await vi.waitFor(() => {
            const it = container.querySelector(
                '.xh-blueprint-selection-toolbar button[title^="Delete"]'
            );
            expect(it).toBeTruthy();
            return it;
        });
        fireEvent.click(remove);
        await wait(20);
        expect(document.activeElement).not.toBe(surface());
        answer(false);
        await vi.waitFor(() => expect(document.activeElement).toBe(surface()));
    });
});
