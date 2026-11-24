import {act, render} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import type {ChartModel} from '@xh/hoist/cmp/chart';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    type Blueprint,
    BlueprintDesignModel,
    BlueprintModel,
    FakeBlueprintDataProvider
} from '../../../blueprint';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {blueprintView} from './BlueprintView';
import type {DashboardWidgetModel} from './DashboardWidget';
import type {BlueprintViewModel} from './impl/BlueprintViewModel';
import {paletteDrag} from './impl/paletteDrag';

/**
 * Gestures over a designer's canvas leave nothing behind: however many drags, drops, moves and
 * undos a designer makes, the page holds the same listeners, observers and models as after one.
 */
describe('blueprint gestures', () => {
    beforeAll(() => initTestAppAsync());

    it('leave no listeners, observers or models behind, however many there are', async () => {
        const {fire, round, census} = await setup();
        await round();
        const after1 = census();
        for (let i = 0; i < 8; i++) await round();
        fire(window, 'dragend');
        expect(census()).toEqual(after1);
    });

    it("keeps each chart's config through cell moves and undos, so no chart is rebuilt", async () => {
        // Hoist rebuilds a chart for each new config, and Highcharts leaks a resize observer each time.
        const {model, view} = await setup(bp => {
                bp.elements.gauge = {
                    component: 'gauge',
                    config: {source: 'positions', value: 'mktVal', max: 1000}
                };
                bp.elements.heat = {
                    component: 'heatmap',
                    config: {source: 'positions', x: 'sector', y: 'strategy', value: 'pnlDay'}
                };
                bp.elements.dashboard.children.push(
                    {id: 'gauge', x: 0, y: 14, w: 3, h: 4},
                    {id: 'heat', x: 3, y: 14, w: 6, h: 4}
                );
            }),
            canvas = view.getWidgetModel('dashboard') as DashboardWidgetModel,
            charts = ['sectorChart', 'gauge', 'heat'].map(
                id => view.getWidgetModel(id) as unknown as {chartModel: ChartModel}
            ),
            configs = () => charts.map(it => it.chartModel.highchartsConfig);
        await vi.waitFor(() =>
            charts.forEach(it => expect(it.chartModel.series.length).toBeGreaterThan(0))
        );
        const before = configs();
        for (const id of ['sectorChart', 'gauge', 'heat']) {
            act(() => {
                canvas.moveCell(id, {y: 30});
            });
            await act(() => wait(50));
            act(() => model.undo());
            await act(() => wait(50));
        }
        configs().forEach((it, i) => expect(it).toBe(before[i]));
    });

    it('checks each place once a drag, and leaves the preview alone while the place holds', async () => {
        const {fire, design, view, layoutEl} = await setup(),
            check = vi.spyOn(design, 'canDropAt');
        act(() => paletteDrag.start({component: 'markdown', size: {w: 4, h: 2}, add: () => {}}));
        fire(layoutEl(), 'dragover', {x: 100, y: 5000});
        const first = view.dropPreview;
        for (let x = 100; x < 400; x += 10) fire(layoutEl(), 'dragover', {x, y: 5000});
        expect(check).toHaveBeenCalledTimes(1);
        expect(view.dropPreview).toBe(first);
        fire(document.body, 'dragend');
        act(() => paletteDrag.end());

        // Once the blueprint changes, the same place is checked again.
        act(() => {
            design.setConfig('posGrid', '/title', 'Book');
        });
        act(() => paletteDrag.start({component: 'markdown', size: {w: 4, h: 2}, add: () => {}}));
        fire(layoutEl(), 'dragover', {x: 100, y: 5000});
        expect(check).toHaveBeenCalledTimes(2);
    });
});

//------------------
// Test support
//------------------
async function setup(adjust: (bp: Blueprint) => void = null) {
    const live = new Map<string, number>(),
        bump = (key: string, by: number) => live.set(key, (live.get(key) ?? 0) + by),
        targets = new Map<EventTarget, string>([
            [window, 'window'],
            [document, 'document']
        ]),
        // A listener counts once however often it is added, as the DOM keeps it once.
        added = new Set<string>(),
        ids = new Map<unknown, number>(),
        keyOf = (target: EventTarget, type: string, fn: unknown, opts: unknown) => {
            const capture = typeof opts === 'boolean' ? opts : !!(opts as any)?.capture;
            if (!ids.has(fn)) ids.set(fn, ids.size);
            return `${targets.get(target)}|${type}|${capture}|${ids.get(fn)}`;
        },
        // jsdom gives the window its own methods, and the document the prototype's.
        spies = [window, EventTarget.prototype].flatMap(owner => {
            const {addEventListener: add, removeEventListener: remove} = owner;
            return [
                vi.spyOn(owner, 'addEventListener').mockImplementation(function (
                    this: EventTarget,
                    type,
                    fn,
                    opts
                ) {
                    const target = this ?? window;
                    if (targets.has(target)) {
                        const key = keyOf(target, type, fn, opts);
                        if (!added.has(key)) {
                            added.add(key);
                            bump(`${targets.get(target)} ${type}`, 1);
                        }
                    }
                    return add.call(target, type, fn, opts);
                }),
                vi.spyOn(owner, 'removeEventListener').mockImplementation(function (
                    this: EventTarget,
                    type,
                    fn,
                    opts
                ) {
                    const target = this ?? window;
                    if (targets.has(target) && added.delete(keyOf(target, type, fn, opts))) {
                        bump(`${targets.get(target)} ${type}`, -1);
                    }
                    return remove.call(target, type, fn, opts);
                })
            ];
        }),
        width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200),
        Observer = window.ResizeObserver;
    const observers = new Set<ResizeObserver>();
    class CountedObserver extends Observer {
        constructor(cb: ResizeObserverCallback) {
            super(cb);
            observers.add(this);
        }
        override disconnect() {
            observers.delete(this);
            super.disconnect();
        }
    }
    window.ResizeObserver = CountedObserver;

    const model = new BlueprintModel({
            blueprint: withAdjusted(loadBlueprint('p2-linked-dashboard.json'), adjust),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
            mode: 'design',
            access: 'write'
        }),
        design = new BlueprintDesignModel({blueprintModel: model}),
        {container, unmount} = render(blueprintView({model, designModel: design}) as ReactElement);
    onTestFinished(() => {
        unmount();
        design.destroy();
        model.destroy();
        paletteDrag.end();
        window.ResizeObserver = Observer;
        [...spies, width].forEach(it => it.mockRestore());
    });
    const view = await vi.waitFor(() => {
        const it = XH.getModels<BlueprintViewModel>('BlueprintViewModel').find(
            m => m.blueprintModel === model
        );
        expect(it).toBeTruthy();
        return it;
    });
    const canvas = view.getWidgetModel('dashboard') as DashboardWidgetModel,
        layoutEl = () => container.querySelector<HTMLElement>('.react-grid-layout'),
        was = document.elementFromPoint;
    await vi.waitFor(() => expect(layoutEl()).toBeTruthy());
    document.elementFromPoint = () => layoutEl();
    onTestFinished(() => {
        document.elementFromPoint = was;
    });

    const fire = (target: EventTarget, type: string, at = {x: 300, y: 200}) => {
        const e = new Event(type, {bubbles: true, cancelable: true});
        Object.assign(e, {clientX: at.x, clientY: at.y, dataTransfer: {dropEffect: 'none'}});
        act(() => {
            target.dispatchEvent(e);
        });
    };

    // One of each gesture: a palette drag over the dashboard that leaves, one that drops, a cell
    // move, and the undo of both edits.
    const round = async () => {
        for (const drops of [false, true]) {
            act(() =>
                paletteDrag.start({
                    component: 'markdown',
                    size: {w: 4, h: 2},
                    add: (parentId, opts) => design.addWidget('markdown', parentId, opts)
                })
            );
            fire(layoutEl(), 'dragenter');
            // Below every cell, as jsdom lays out no cell for the drop to push aside.
            for (let x = 100; x < 400; x += 50) fire(layoutEl(), 'dragover', {x, y: 5000});
            fire(drops ? layoutEl() : document.body, drops ? 'drop' : 'dragover');
            fire(document.body, 'dragend');
            act(() => paletteDrag.end());
        }
        act(() => {
            canvas.moveCell(canvas.cells[0].id, {y: 30});
        });
        act(() => {
            model.undo();
            model.undo();
        });
        await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    };

    const census = () => ({
        listeners: Object.fromEntries([...live].filter(([, n]) => n)),
        resizeObservers: observers.size,
        models: XH.getModels('*').length,
        overlaySources: Object.keys(view.overlay.sources).length,
        elements: Object.keys(model.blueprint.elements).length
    });

    return {fire, round, census, model, view, design, layoutEl};
}

function withAdjusted(bp: Blueprint, adjust: (bp: Blueprint) => void): Blueprint {
    adjust?.(bp);
    return bp;
}
