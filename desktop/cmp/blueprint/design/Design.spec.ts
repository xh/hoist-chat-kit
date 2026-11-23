import {act, fireEvent, render, within} from '@testing-library/react';
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
import {layoutGesture} from '../../layout';
import {OverlayModel} from '../../layout/overlay';
import {cellElementAt, viewAt} from '../impl/ElementHost';
import {altHold} from './impl/altHold';
import {paletteDrag} from '../impl/paletteDrag';
import {designHotkeys} from './impl/designHotkeys';
import {designMarks} from './impl/designOverlay';
import {BlueprintViewModel} from '../impl/BlueprintViewModel';
import {elementInspector} from './ElementInspector';
import {ElementOutlineModel} from './ElementOutline';
import {
    removeElementAsync,
    removePresetGroupAsync,
    removeSelectionAsync
} from './impl/designActions';

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

    it('brings a selected canvas view into view, activating the tab that holds it', () => {
        const {design, model} = open('p3-morning-report.json'),
            view = new BlueprintViewModel(model, {designModel: design});
        onTestFinished(() => view.destroy());
        const tabs = view.getWidgetModel('tabs') as any;
        expect(tabs.tabContainerModel.activeTabId).toBe('overview');
        design.select({kind: 'view', id: 'posGrid', of: 'positions'});
        expect(tabs.tabContainerModel.activeTabId).toBe('positions');
    });

    it('brings the selection into view when the canvas mounts, as after the Map', () => {
        const {design, model} = open('p3-morning-report.json');
        design.select({kind: 'element', id: 'ordersGrid'});
        const view = new BlueprintViewModel(model, {designModel: design});
        onTestFinished(() => view.destroy());
        expect((view.getWidgetModel('tabs') as any).tabContainerModel.activeTabId).toBe('orders');
    });

    it("finds the canvas view a click on its header or grip lands on, but not on the header's items", () => {
        const cell = document.createElement('div');
        cell.innerHTML =
            '<div data-blueprint-view="sectorChart" data-blueprint-canvas="overview">' +
            '<div data-blueprint-view-header><span class="title">Day P&L</span>' +
            '<div data-blueprint-element="views"><span class="item"></span></div></div>' +
            '<div class="body"><div data-blueprint-element="sectorChart"></div></div></div>' +
            '<div data-blueprint-view="reportActions" data-blueprint-canvas="overview">' +
            '<span data-blueprint-view-grip="reportActions" class="grip"></span></div>';
        const host = document.createElement('div');
        host.appendChild(cell);
        const at = (sel: string) => viewAt(cell.querySelector(sel) as HTMLElement, host);
        expect(at('.title')).toEqual({id: 'sectorChart', of: 'overview'});
        expect(at('.grip')).toEqual({id: 'reportActions', of: 'overview'});
        // A header item is an element of its own, and a click in the body is the widget's.
        expect(at('.item')).toBeNull();
        expect(at('.body')).toBeNull();
        expect(cellElementAt(cell.querySelector('.title') as HTMLElement, host)).toBe(
            'sectorChart'
        );
    });

    it('climbs from a widget to its view to its canvas with Esc, and back down with Enter', () => {
        const {design} = open('p3-morning-report.json'),
            keys = designHotkeys(design),
            press = (combo: string) =>
                keys
                    .find(it => it.combo === combo)
                    .onKeyDown({
                        target: document.body,
                        preventDefault: () => null
                    } as any),
            sel = () => design.selection;
        design.select({kind: 'element', id: 'posGrid'});
        press('esc');
        expect(sel()).toEqual({kind: 'view', id: 'posGrid', of: 'positions'});
        press('esc');
        expect(sel()).toEqual({kind: 'element', id: 'positions'});
        press('enter');
        expect(sel()).toMatchObject({kind: 'view', of: 'positions'});
        const first = sel().id;
        press('enter');
        expect(sel()).toEqual({kind: 'element', id: first});
    });

    it('marks a hovered canvas, at a gap between its cells, with a faint outline and no tag', () => {
        const {design} = open('p3-morning-report.json'),
            overlay = new OverlayModel();
        onTestFinished(() => overlay.destroy());
        design.setHovered('overview');
        const [mark] = designMarks(design, overlay),
            {container} = render(
                mark.render({
                    x: 0,
                    y: 100,
                    width: 100,
                    height: 50,
                    area: {width: 500, height: 500},
                    roomAbove: 100,
                    clip: null
                }) as any
            );
        expect(container.querySelector('.xh-blueprint-overlay__outline--faint')).not.toBeNull();
        expect(container.querySelector('.xh-blueprint-overlay__tag')).toBeNull();
    });

    it('deletes the widget in a selected view with Del', async () => {
        const {design, model} = open('p3-morning-report.json'),
            toast = vi.spyOn(XH, 'toast').mockReturnValue(null);
        onTestFinished(() => toast.mockRestore());
        design.select({kind: 'view', id: 'priceChart', of: 'positions'});
        designHotkeys(design)
            .find(it => it.combo === 'del')
            .onKeyDown({target: document.body, preventDefault: () => null} as any);
        await vi.waitFor(() => expect(model.blueprint.elements).not.toHaveProperty('priceChart'));
    });

    it('marks a selected view at its frame with an outline over a tint, and nothing more', () => {
        const {design} = open('p3-morning-report.json'),
            overlay = new OverlayModel(),
            host = document.createElement('div');
        onTestFinished(() => overlay.destroy());
        host.innerHTML = '<div data-blueprint-view="posGrid"></div>';
        overlay.setHostEl(host);
        design.select({kind: 'view', id: 'posGrid', of: 'positions'});
        const [mark] = designMarks(design, overlay),
            {container} = render(
                mark.render({
                    x: 0,
                    y: 100,
                    width: 100,
                    height: 50,
                    area: {width: 500, height: 500},
                    roomAbove: 100,
                    clip: null
                }) as any
            );
        expect(mark.target).toBe('[data-blueprint-view="posGrid"]');
        expect(container.querySelector('.xh-blueprint-overlay__outline--view')).not.toBeNull();
        expect(container.children).toHaveLength(1);
    });

    it('draws no marks while a cell or view is moved or resized, and draws them again after', () => {
        const {design} = open('p3-morning-report.json'),
            overlay = new OverlayModel();
        onTestFinished(() => {
            layoutGesture.end();
            overlay.destroy();
        });
        design.select({kind: 'element', id: 'overview'});
        design.setHovered('headline');
        expect(designMarks(design, overlay).map(it => it.key)).toEqual(['hover', 'selection']);
        layoutGesture.start();
        expect(designMarks(design, overlay)).toEqual([]);
        layoutGesture.end();
        expect(designMarks(design, overlay)).toHaveLength(2);
    });

    it('selects the innermost element a click lands on, and outlines it, in design mode only, keeping its widget across a mode switch', async () => {
        stubRects();
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
        await vi.waitFor(() => expect(overlayMark(container, 'selection')).not.toBeNull());

        // Run mode keeps the same elements, so switching remounts no widget and moves nothing.
        const widget = inner.firstElementChild;
        model.setMode('run');
        rerender(blueprintView({model, designModel: design}) as ReactElement);
        expect(overlayMark(container, 'selection')).toBeNull();
        expect(inner.isConnected).toBe(true);
        expect(inner.firstElementChild).toBe(widget);
        fireEvent.click(inner);
        expect(design.selectedElementId).toBe('overview');
        design.select(null);
        fireEvent.click(inner);
        expect(design.selectedElementId).toBeNull();
    });

    it("selects and hovers nothing in Interact, where clicks are the widgets', switched by I and E", () => {
        stubRects();
        const {design, model} = open('p3-morning-report.json'),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            inner = [...container.querySelectorAll('.xh-blueprint-view__design-element')].at(-1),
            press = (combo: string) =>
                designHotkeys(design)
                    .find(it => it.combo === combo)
                    .onKeyDown({target: document.body, preventDefault: () => null} as any);
        design.setHovered('headline');
        press('i');
        expect(design.interaction).toBe('interact');
        expect(design.hoveredId).toBeNull();
        fireEvent.mouseOver(inner);
        fireEvent.click(inner);
        expect(design.hoveredId).toBeNull();
        expect(design.selection).toBeNull();
        press('e');
        expect(design.interaction).toBe('edit');
        fireEvent.click(inner);
        expect(design.selectedElementId).toBe('overview');

        // Alt held in Edit lets one click through to the widget, selecting nothing.
        design.select(null);
        fireEvent.keyDown(window, {key: 'Alt'});
        fireEvent.click(inner);
        expect(design.selection).toBeNull();
        fireEvent.click(inner);
        expect(design.selectedElementId).toBe('overview');
        fireEvent.keyUp(window, {key: 'Alt'});

        // The key's state on the click itself counts too, as when its key-up was lost.
        design.select(null);
        fireEvent.click(inner, {altKey: true});
        expect(design.selection).toBeNull();
    });

    it('opens the design menu on a right-click in Edit, for what it lands on, and leaves it to the widget in Interact', async () => {
        stubRects();
        const {design, model} = open('p3-morning-report.json'),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            inner = [...container.querySelectorAll('.xh-blueprint-view__design-element')].at(-1);
        expect(fireEvent.contextMenu(inner)).toBe(false);
        expect(design.selectedElementId).toBe('overview');
        await vi.waitFor(() => expect(document.body.textContent).toContain('Add a widget…'));
        expect(document.body.textContent).toContain('Select tabs');

        design.select(null);
        design.setInteraction('interact');
        expect(fireEvent.contextMenu(inner)).toBe(true);
        expect(design.selection).toBeNull();
    });

    it("leaves the selection's body undraggable, and stops text selection only in Edit", () => {
        stubRects();
        const {design, model} = open('p3-morning-report.json'),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            host = (id: string) => container.querySelector(`[data-blueprint-element="${id}"]`),
            editClass = 'xh-blueprint-view__design-element--edit';
        act(() => design.select({kind: 'element', id: 'overview'}));
        expect(host('overview').getAttribute('draggable')).toBeNull();
        expect(host('overview').classList).toContain(editClass);
        act(() => design.setInteraction('interact'));
        expect(host('overview').classList).not.toContain(editClass);
    });

    it('hovers the innermost element under the pointer, with a dashed outline and no tag, as view state', async () => {
        stubRects();
        const {design, model} = open('p3-morning-report.json'),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            inner = container.querySelector('[data-blueprint-element="tabs"]');
        fireEvent.mouseOver(inner);
        expect(design.hoveredId).toBe('tabs');
        const hover = await vi.waitFor(() => {
            const it = overlayMark(container, 'hover');
            expect(it).not.toBeNull();
            return it;
        });
        expect(hover.querySelector('.xh-blueprint-overlay__outline--hover')).toBeTruthy();
        expect(hover.querySelector('.xh-blueprint-overlay__tag')).toBeNull();
        fireEvent.mouseLeave(inner);
        expect(design.hoveredId).toBeNull();
        expect(model.history).toHaveLength(0);
    });

    it('marks no hover in Interact, or while Alt passes the next click through', () => {
        const {design} = open('p3-morning-report.json'),
            overlay = new OverlayModel(),
            keys = () => designMarks(design, overlay).map(it => it.key),
            stop = altHold.follow();
        onTestFinished(() => {
            stop();
            overlay.destroy();
        });
        design.setHovered('tabs');
        expect(keys()).toContain('hover');
        design.setInteraction('interact');
        expect(keys()).not.toContain('hover');
        design.setInteraction('edit');
        design.setHovered('tabs');
        window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Alt'}));
        expect(keys()).not.toContain('hover');
        window.dispatchEvent(new KeyboardEvent('keyup', {key: 'Alt'}));
        expect(keys()).toContain('hover');
    });

    it('keeps the Alt hold through the click that ends a text selection, so the text stays selected', () => {
        stubRects();
        const {design, model} = open('p3-morning-report.json'),
            {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            host = container.querySelector('[data-blueprint-element="overview"]'),
            stop = altHold.follow();
        const text = document.body.appendChild(document.createElement('p'));
        text.textContent = 'Write this';
        onTestFinished(() => {
            stop();
            window.getSelection().removeAllRanges();
            text.remove();
        });
        const press = () => window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Alt'}));
        act(press);
        const range = document.createRange();
        range.selectNodeContents(text);
        // A selection takes no second range.
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        expect(window.getSelection().isCollapsed).toBe(false);
        fireEvent.click(host);
        expect(altHold.active).toBe(true);
        expect(design.selectedElementId).toBeNull();

        // A plain click passes through, and uses the hold up.
        window.getSelection().removeAllRanges();
        fireEvent.click(host);
        expect(altHold.active).toBe(false);
        expect(design.selectedElementId).toBeNull();
    });

    it('previews a drop at a point, and drops a dragged widget there with a line marking the place', async () => {
        const model = new BlueprintModel({
                blueprint: {
                    schema: {blueprint: 1},
                    root: 'page',
                    elements: {
                        page: {
                            component: 'box',
                            config: {direction: 'row'},
                            children: [{id: 'a'}, {id: 'b'}]
                        },
                        a: {component: 'markdown', config: {text: 'A'}},
                        b: {component: 'markdown', config: {text: 'B'}}
                    }
                },
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model});
        onTestFinished(() => {
            design.destroy();
            model.destroy();
            paletteDrag.end();
        });
        const {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            el = (id: string) =>
                container.querySelector<HTMLElement>(`[data-blueprint-element="${id}"]`),
            rect = (id: string, x: number, width: number) => {
                el(id).getBoundingClientRect = () =>
                    ({
                        left: x,
                        right: x + width,
                        top: 0,
                        bottom: 100,
                        width,
                        height: 100
                    }) as DOMRect;
            },
            was = document.elementFromPoint;
        rect('page', 0, 300);
        rect('a', 0, 150);
        rect('b', 150, 150);
        document.elementFromPoint = () => el('b');
        onTestFinished(() => {
            document.elementFromPoint = was;
        });
        // Hoist lists a model once it has settled.
        const view = await vi.waitFor(() => {
            const it = XH.getModels<BlueprintViewModel>('BlueprintViewModel').find(
                m => m.blueprintModel === model
            );
            expect(it).toBeTruthy();
            return it;
        });

        expect(view.previewDrop({widget: 'markdown'}, 260, 50)).toEqual({
            container: 'page',
            index: 2,
            refusal: null
        });

        paletteDrag.start({component: 'markdown', size: {w: 6, h: 1}, add: () => null});
        const fire = (type: string) => {
            const e = new Event(type, {bubbles: true, cancelable: true});
            Object.assign(e, {clientX: 260, clientY: 50, dataTransfer: {dropEffect: 'none'}});
            el('b').dispatchEvent(e);
            return e;
        };
        expect(fire('dragover').defaultPrevented).toBe(true);
        expect(view.dropPreview.target).toEqual({container: 'page', index: 2});
        await vi.waitFor(() =>
            expect(document.body.querySelector('.xh-blueprint-drop__line--row')).toBeTruthy()
        );

        fire('drop');
        expect(view.dropPreview).toBeNull();
        const children = model.blueprint.elements.page.children.map(it => it.id);
        expect(children).toHaveLength(3);
        expect(design.selectedElementId).toBe(children[2]);
    });

    it('previews and drops onto a container inside a canvas cell, though the canvas takes drags over it', async () => {
        const model = new BlueprintModel({
                blueprint: {
                    schema: {blueprint: 1},
                    root: 'page',
                    elements: {
                        page: {
                            component: 'dashCanvas',
                            children: [{id: 'inner', x: 0, y: 0, w: 6, h: 4}]
                        },
                        inner: {component: 'box', children: [{id: 'note'}]},
                        note: {component: 'markdown', config: {text: 'Note'}}
                    }
                },
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            // jsdom has no layout: the canvas waits for a measured width before it draws the grid.
            width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
        onTestFinished(() => {
            width.mockRestore();
            design.destroy();
            model.destroy();
            paletteDrag.end();
        });
        stubRects();
        const {container} = render(blueprintView({model, designModel: design}) as ReactElement),
            el = (id: string) =>
                container.querySelector<HTMLElement>(`[data-blueprint-element="${id}"]`),
            was = document.elementFromPoint;
        await vi.waitFor(() => expect(el('note')).toBeTruthy());
        document.elementFromPoint = () => el('note');
        onTestFinished(() => {
            document.elementFromPoint = was;
        });
        // Hoist lists a model once it has settled.
        const view = await vi.waitFor(() => {
            const it = XH.getModels<BlueprintViewModel>('BlueprintViewModel').find(
                m => m.blueprintModel === model
            );
            expect(it).toBeTruthy();
            return it;
        });

        paletteDrag.start({component: 'markdown', size: {w: 6, h: 1}, add: () => null});
        const fire = (type: string) => {
            const e = new Event(type, {bubbles: true, cancelable: true});
            Object.assign(e, {clientX: 150, clientY: 80, dataTransfer: {dropEffect: 'none'}});
            act(() => {
                el('note').dispatchEvent(e);
            });
        };
        fire('dragover');
        expect(view.dropPreview?.target.container).toBe('inner');
        fire('drop');
        expect(view.dropPreview).toBeNull();
        expect(model.blueprint.elements.inner.children).toHaveLength(2);
        expect(model.blueprint.elements.page.children.map(it => it.id)).toEqual(['inner']);
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
        expect(design.selectedViewId).toBe('sectorChart');
        key(canvas, 'Escape');
        expect(design.selectedElementId).toBe('overview');
        key(canvas, 'Enter');
        expect(design.selectedViewId).toBe('reportActions');
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

    it('shows an empty container one quiet empty state over its own surface, with a way to add', () => {
        // jsdom has no layout: the canvas waits for a measured width before it draws cells.
        const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
        onTestFinished(() => spy.mockRestore());
        const {model, design} = open('p2-linked-dashboard.json'),
            dc = design.addWidget('dashContainer').id,
            onAddWidget = vi.fn(),
            {container} = render(
                blueprintView({model, designModel: design, onAddWidget}) as ReactElement
            ),
            host = container.querySelector(`[data-blueprint-element="${dc}"]`),
            empties = host.querySelectorAll('.xh-blueprint-view__design-empty');
        expect(empties).toHaveLength(1);
        const [empty] = empties as unknown as HTMLElement[];
        expect(empty.parentElement).toBe(host);
        // No inline position, which would stack it below the container rather than over it.
        expect(empty.style.position).toBe('');
        expect(empty.classList).toContain('xh-blueprint-view__design-empty--quiet');
        fireEvent.click(within(empty).getByText('Add a widget to this container'));
        expect(onAddWidget).toHaveBeenCalledWith({parent: dc, slot: 'children'});
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

    it('offers to fix a widget that needs config, focusing the field in the Inspector', async () => {
        const model = new BlueprintModel({
                blueprint: {
                    root: 'page',
                    elements: {
                        page: {
                            component: 'box',
                            config: {direction: 'column'},
                            children: [{id: 'name'}]
                        },
                        name: {component: 'textInput', config: {label: 'Name'}}
                    }
                },
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model});
        onTestFinished(() => {
            design.destroy();
            model.destroy();
        });
        const view = render(blueprintView({model, designModel: design}) as ReactElement),
            inspector = render(elementInspector({designModel: design}) as ReactElement);
        fireEvent.click(view.getByText('Pick a variable'));
        expect(design.selectedElementId).toBe('name');
        await vi.waitFor(() =>
            expect(document.activeElement?.closest('[data-config-key="sets"]')).toBe(
                inspector.container.querySelector('[data-config-key="sets"]')
            )
        );
        expect(model.history).toHaveLength(0);
    });

    it('removes a source or variable with a toast to undo, and asks first when sources join it', async () => {
        const {design, model} = open('p3-morning-report.json'),
            toast = vi.spyOn(XH, 'toast').mockReturnValue(null),
            confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(false);
        onTestFinished(() => {
            toast.mockRestore();
            confirm.mockRestore();
        });
        const {id} = design.addVariable();
        design.select({kind: 'variable', id});
        await removeSelectionAsync(design);
        expect(model.blueprint.variables).not.toHaveProperty(id);
        expect((toast.mock.calls.at(-1)[0] as any).actionButtonProps.text).toBe('Undo');

        const joined = new BlueprintModel({
                blueprint: loadBlueprint('p8-joined-positions.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            joinedDesign = new BlueprintDesignModel({blueprintModel: joined});
        onTestFinished(() => {
            joinedDesign.destroy();
            joined.destroy();
        });
        joinedDesign.select({kind: 'source', id: 'funds'});
        await removeSelectionAsync(joinedDesign);
        expect(confirm.mock.calls[0][0].message).toMatch(/positions/);
        expect(joined.blueprint.sources).toHaveProperty('funds');
    });

    it('marks a widget in a canvas cell at its cell, header included, and draws nothing in run mode', () => {
        const {design, model} = open('p3-morning-report.json'),
            overlay = new OverlayModel(),
            host = document.createElement('div');
        onTestFinished(() => overlay.destroy());
        host.innerHTML = '<div data-blueprint-view="sectorChart"></div>';
        overlay.setHostEl(host);
        design.select({kind: 'element', id: 'sectorChart'});
        design.setHovered('headline');
        expect(designMarks(design, overlay).map(it => [it.key, it.target])).toEqual([
            ['hover', '[data-blueprint-element="headline"]'],
            ['selection', '[data-blueprint-view="sectorChart"]']
        ]);
        model.setMode('run');
        expect(designMarks(design, overlay)).toEqual([]);
    });
});

// jsdom lays out nothing, so give every element a box for the overlay to draw marks at.
function stubRects() {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 200,
        height: 100,
        right: 200,
        bottom: 100
    } as DOMRect);
    onTestFinished(() => spy.mockRestore());
}

// Overlay marks draw in a portal on the page, outside the view.
function overlayMark(_container: Element, key: string): Element {
    return document.body.querySelector(`[data-overlay-mark="${key}"]`);
}
