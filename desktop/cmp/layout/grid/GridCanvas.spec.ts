import {act, fireEvent, render} from '@testing-library/react';
import {div} from '@xh/hoist/cmp/layout';
import {runInAction} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {layoutGesture} from '../gesture';
import {
    compactCells,
    gridCanvas,
    GridCanvasModel,
    type GridCell,
    type GridCanvasProps,
    placeCell
} from './index';

/**
 * A canvas of cells on a grid, controlled by the cells it is given. It keeps no layout of its
 * own: a finished move or resize is reported once, and the canvas then shows the cells it is given
 * again, so a gesture the host does not apply snaps back.
 */
describe('gridCanvas', () => {
    beforeAll(() => initTestAppAsync());

    const CELLS: GridCell[] = [
        {id: 'posGrid', x: 0, y: 0, w: 6, h: 4},
        {id: 'chart', x: 6, y: 0, w: 6, h: 4}
    ];

    it('draws each item as a frame, with its header and body', () => {
        const {container} = renderCanvas({
            headerRenderer: id => (id === 'posGrid' ? div({className: 'test-header'}) : null),
            frameProps: id => ({'data-test-frame': id})
        });

        const frame = container.querySelector('[data-test-frame="posGrid"]');
        expect(frame.querySelector('.xh-layout-grid__header .test-header')).toBeTruthy();
        expect(frame.querySelector('.xh-layout-grid__body .test-body')).toBeTruthy();
        expect(
            container.querySelector('[data-test-frame="chart"] .xh-layout-grid__header')
        ).toBeNull();
    });

    it('draws a grip as the drag handle of a cell with no header', () => {
        const {container} = renderCanvas({
            headerRenderer: id => (id === 'posGrid' ? div({className: 'test-header'}) : null),
            gripRenderer: () => div({className: 'test-grip'})
        });
        expect(
            container.querySelector('[data-grid-item="chart"] .xh-layout-grid__grip .test-grip')
        ).toBeTruthy();
        expect(
            container.querySelector('[data-grid-item="posGrid"] .xh-layout-grid__grip')
        ).toBeNull();
    });

    it('follows the cells it is given, keeping no copy', () => {
        const {container, rerender} = renderCanvas({});
        const before = frameStyle(container, 'chart');

        rerender(canvas({cells: [CELLS[0], {...CELLS[1], x: 0, y: 4}]}));

        expect(frameStyle(container, 'chart')).not.toEqual(before);
    });

    it('renders an empty canvas as a live surface, not a placeholder', () => {
        const {container} = renderCanvas({cells: []});
        expect(container.querySelector('.xh-layout-grid .react-grid-layout')).toBeTruthy();
    });

    it('resizes an editable cell from every side and corner', () => {
        const {container} = renderCanvas({editable: true}),
            frame = container.querySelector('[data-grid-item="chart"]'),
            axes = [...frame.querySelectorAll('.react-resizable-handle')].map(it =>
                [...it.classList].find(c => c.startsWith('react-resizable-handle-')).slice(23)
            );
        expect(axes.sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
        expect(renderCanvas({}).container.querySelectorAll('.react-resizable-handle').length).toBe(
            0
        );
    });

    it('draws the grid only when asked', () => {
        expect(renderCanvas({}).container.querySelector('.xh-layout-grid__background')).toBeNull();
        expect(
            renderCanvas({showGrid: true}).container.querySelector('.xh-layout-grid__background')
        ).toBeTruthy();
    });

    describe('gestures', () => {
        it('reports a finished move once, with every item it changed', () => {
            const onChange = vi.fn(),
                model = gestureModel(onChange);

            model.startGesture();
            model.endGesture('move', 'chart', [
                {i: 'posGrid', x: 0, y: 4, w: 6, h: 4},
                {i: 'chart', x: 0, y: 0, w: 6, h: 4}
            ]);

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith(
                [
                    {id: 'posGrid', x: 0, y: 4, w: 6, h: 4},
                    {id: 'chart', x: 0, y: 0, w: 6, h: 4}
                ],
                {kind: 'move', id: 'chart'}
            );
        });

        it('reports nothing for a gesture that changed nothing', () => {
            const onChange = vi.fn(),
                model = gestureModel(onChange);

            model.startGesture();
            model.endGesture('resize', 'chart', CELLS.map(toLayout));

            expect(onChange).not.toHaveBeenCalled();
        });

        it('shows the given cells again after every gesture, so an unapplied one snaps back', () => {
            const model = gestureModel(() => {}),
                before = model.layout;

            model.startGesture();
            model.endGesture('move', 'chart', [{i: 'chart', x: 0, y: 8, w: 6, h: 4}]);

            expect(model.layout).not.toBe(before);
            expect(model.layout.map(({i, x, y, w, h}) => ({i, x, y, w, h}))).toEqual(
                CELLS.map(toLayout)
            );
        });

        it('cancels a gesture on Esc: nothing is reported, and the key goes no further', () => {
            const onChange = vi.fn(),
                model = gestureModel(onChange),
                outer = vi.fn();
            document.addEventListener('keydown', outer);
            onTestFinished(() => document.removeEventListener('keydown', outer));

            model.startGesture();
            document.body.dispatchEvent(
                new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})
            );
            model.endGesture('move', 'chart', [{i: 'chart', x: 0, y: 8, w: 6, h: 4}]);

            expect(onChange).not.toHaveBeenCalled();
            expect(outer).not.toHaveBeenCalled();
        });

        it('stops listening for Esc once the gesture ends', () => {
            const model = gestureModel(() => {}),
                outer = vi.fn();
            document.addEventListener('keydown', outer);
            onTestFinished(() => document.removeEventListener('keydown', outer));

            model.startGesture();
            model.endGesture('move', 'chart', CELLS.map(toLayout));
            document.body.dispatchEvent(
                new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})
            );

            expect(outer).toHaveBeenCalledTimes(1);
        });

        it('keeps the moved cell where it is dropped, moving the cells it lands on down', () => {
            const model = gestureModel(() => {});
            model.startGesture('chart');
            const at = (layout: object[]) =>
                model.compactor
                    .compact(layout as any, 12)
                    .map(({i, x, y, w, h}) => ({i, x, y, w, h}));

            expect(
                at([
                    {i: 'posGrid', x: 0, y: 0, w: 6, h: 4},
                    {i: 'chart', x: 0, y: 0, w: 6, h: 4}
                ])
            ).toEqual([
                {i: 'posGrid', x: 0, y: 4, w: 6, h: 4},
                {i: 'chart', x: 0, y: 0, w: 6, h: 4}
            ]);
            // Once the moved cell passes on, the other goes back to where it was.
            expect(
                at([
                    {i: 'posGrid', x: 0, y: 4, w: 6, h: 4},
                    {i: 'chart', x: 6, y: 4, w: 6, h: 4}
                ])
            ).toEqual([
                {i: 'posGrid', x: 0, y: 0, w: 6, h: 4},
                {i: 'chart', x: 6, y: 4, w: 6, h: 4}
            ]);
        });

        it('moves the cells a resize grows over down, so no two overlap', () => {
            const model = gestureModel(() => {});
            model.startGesture('posGrid');
            const next = model.compactor.compact(
                [
                    {i: 'posGrid', x: 0, y: 0, w: 8, h: 4},
                    {i: 'chart', x: 6, y: 0, w: 6, h: 4}
                ] as any,
                12
            );
            expect(next.find(it => it.i === 'chart')).toMatchObject({x: 6, y: 4});
        });

        it('marks a gesture as under way until it ends, with no text selection meanwhile', () => {
            const model = gestureModel(() => {});
            model.startGesture('chart');
            expect(layoutGesture.active).toBe(true);
            expect(document.body.classList).toContain('xh-layout-gesture');
            model.endGesture('move', 'chart', CELLS.map(toLayout));
            expect(layoutGesture.active).toBe(false);
            expect(document.body.classList).not.toContain('xh-layout-gesture');
        });

        function gestureModel(onChange: GridCanvasProps['onChange']) {
            const model = new GridCanvasModel();
            onTestFinished(() => model.destroy());
            linkProps(model, {cells: CELLS, onChange, compact: false});
            return model;
        }
    });

    describe('compaction', () => {
        const GAPPY: GridCell[] = [
            {id: 'a', x: 0, y: 0, w: 6, h: 2},
            {id: 'b', x: 6, y: 3, w: 6, h: 2},
            {id: 'c', x: 0, y: 5, w: 4, h: 2}
        ];
        const places = (cells: GridCell[]) => cells.map(({id, x, y}) => [id, x, y]);

        it('floats cells up, or left, or leaves them, as its compaction says', () => {
            expect(places(compactCells(GAPPY, {compact: 'vertical'}))).toEqual([
                ['a', 0, 0],
                ['b', 6, 0],
                ['c', 0, 2]
            ]);
            expect(places(compactCells(GAPPY, {compact: 'horizontal'}))).toEqual([
                ['a', 0, 0],
                ['b', 0, 3],
                ['c', 0, 5]
            ]);
            expect(compactCells(GAPPY, {compact: false})).toEqual(GAPPY);
        });

        it('places a cell, then compacts, where it compacts', () => {
            const next = placeCell(
                CELLS,
                {id: 'chart', x: 0, y: 0, w: 6, h: 4},
                {compact: 'vertical'}
            );
            expect(places(next)).toEqual([
                ['posGrid', 0, 4],
                ['chart', 0, 0]
            ]);
            // A cell moved down into empty space floats back up.
            expect(
                places(
                    placeCell(CELLS, {id: 'chart', x: 6, y: 9, w: 6, h: 4}, {compact: 'vertical'})
                )
            ).toEqual([
                ['posGrid', 0, 0],
                ['chart', 6, 0]
            ]);
        });

        it('refuses a place over another cell where collisions are prevented', () => {
            expect(
                placeCell(CELLS, {id: 'chart', x: 3, y: 0, w: 6, h: 4}, {preventCollision: true})
            ).toBeNull();
            expect(
                placeCell(CELLS, {id: 'chart', x: 6, y: 4, w: 6, h: 4}, {preventCollision: true})
            ).not.toBeNull();
        });

        it('gives react-grid-layout the compactor of its compaction, pushing only when it does not compact', () => {
            const model = new GridCanvasModel();
            onTestFinished(() => model.destroy());
            linkProps(model, {cells: CELLS, compact: 'vertical'});
            expect(model.compactor.type).toBe('vertical');
            linkProps(model, {cells: CELLS, compact: false, preventCollision: true});
            expect(model.compactor).toMatchObject({type: null, preventCollision: true});
            linkProps(model, {cells: CELLS, compact: false});
            expect(model.compactor).toMatchObject({type: null, allowOverlap: true});
        });
    });

    it('places a cell no lower than the first free row below the others', () => {
        expect(placeCell(CELLS, {id: 'chart', x: 6, y: 200, w: 6, h: 4}, {compact: false})).toEqual(
            [
                {id: 'posGrid', x: 0, y: 0, w: 6, h: 4},
                {id: 'chart', x: 6, y: 4, w: 6, h: 4}
            ]
        );
    });

    it('places a cell as a drop would, moving the cells it lands on down', () => {
        expect(placeCell(CELLS, {id: 'chart', x: 0, y: 0, w: 6, h: 4}, {compact: false})).toEqual([
            {id: 'posGrid', x: 0, y: 4, w: 6, h: 4},
            {id: 'chart', x: 0, y: 0, w: 6, h: 4}
        ]);
    });

    describe('a drag from outside', () => {
        const dropProps = (onChange = vi.fn(), onDrop = vi.fn()) => ({
            editable: true,
            onChange,
            onDrop,
            onDropOver: () => ({w: 4, h: 2})
        });
        const layoutEl = (container: HTMLElement) =>
            container.querySelector<HTMLElement>('.react-grid-layout');
        const ghosts = (container: HTMLElement) =>
            container.querySelectorAll('.react-grid-item:not([data-grid-item])').length;
        function dragIn(container: HTMLElement) {
            const el = layoutEl(container);
            act(() => {
                fireEvent.dragEnter(el);
                fireEvent.dragOver(el, {clientX: 100, clientY: 300});
            });
            expect(ghosts(container)).toBe(1);
        }

        it('shows where it would drop while over the canvas, its own cells included', () => {
            const {container} = renderCanvas(dropProps());
            dragIn(container);
            const frame = container.querySelector('[data-grid-item="posGrid"]');
            act(() => {
                fireEvent.dragEnter(frame);
                fireEvent.dragLeave(layoutEl(container));
                fireEvent.dragOver(frame, {clientX: 120, clientY: 300});
            });
            expect(ghosts(container)).toBe(1);
        });

        it.each([
            ['moves over anything outside the canvas', 'dragover'],
            ['drops anywhere outside the canvas', 'drop'],
            ['ends, as on Esc or a release outside the window', 'dragend']
        ])('clears its preview as soon as it %s, changing nothing', (_, type) => {
            const onChange = vi.fn(),
                onDrop = vi.fn(),
                {container} = renderCanvas(dropProps(onChange, onDrop)),
                before = frameStyle(container, 'posGrid'),
                outside = document.createElement('div');
            document.body.appendChild(outside);
            onTestFinished(() => outside.remove());
            dragIn(container);
            act(() => {
                outside.dispatchEvent(new Event(type, {bubbles: true, cancelable: true}));
            });
            expect(ghosts(container)).toBe(0);
            expect(onDrop).not.toHaveBeenCalled();
            expect(onChange).not.toHaveBeenCalled();
            expect(frameStyle(container, 'posGrid')).toBe(before);
        });
    });

    //------------------
    // Test support
    //------------------
    function canvas(props: Partial<GridCanvasProps>): ReactElement {
        return gridCanvas({
            cells: CELLS,
            itemRenderer: () => div({className: 'test-body'}),
            ...props
        }) as ReactElement;
    }

    function renderCanvas(props: Partial<GridCanvasProps>) {
        // jsdom has no layout: the canvas waits for a measured width before it draws the grid.
        const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
        onTestFinished(() => spy.mockRestore());
        let ret: ReturnType<typeof render>;
        act(() => {
            ret = render(canvas(props));
        });
        return ret;
    }

    function frameStyle(container: HTMLElement, id: string) {
        const el = container.querySelector(`[data-grid-item="${id}"]`) as HTMLElement;
        return el.getAttribute('style');
    }

    function toLayout({id, x, y, w, h}: GridCell) {
        return {i: id, x, y, w, h};
    }
});

// Give a model the props its component would, as a linked component does on each draw.
function linkProps(model: {_componentProps: object}, props: object) {
    runInAction(() => (model._componentProps = props));
}
