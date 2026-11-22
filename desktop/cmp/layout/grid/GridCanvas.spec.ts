import {act, render} from '@testing-library/react';
import {div} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {layoutGesture} from '../gesture';
import {gridCanvas, GridCanvasModel, type GridCell, type GridCanvasProps, placeCell} from './index';

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
            renderHeader: id => (id === 'posGrid' ? div({className: 'test-header'}) : null),
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
            renderHeader: id => (id === 'posGrid' ? div({className: 'test-header'}) : null),
            renderGrip: () => div({className: 'test-grip'})
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
                    {i: 'chart', x: 6, y: 8, w: 6, h: 4}
                ])
            ).toEqual([
                {i: 'posGrid', x: 0, y: 0, w: 6, h: 4},
                {i: 'chart', x: 6, y: 8, w: 6, h: 4}
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
            model.setProps({cells: CELLS, onChange});
            return model;
        }
    });

    it('places a cell as a drop would, moving the cells it lands on down', () => {
        expect(placeCell(CELLS, {id: 'chart', x: 0, y: 0, w: 6, h: 4})).toEqual([
            {id: 'posGrid', x: 0, y: 4, w: 6, h: 4},
            {id: 'chart', x: 0, y: 0, w: 6, h: 4}
        ]);
    });

    //------------------
    // Test support
    //------------------
    function canvas(props: Partial<GridCanvasProps>): ReactElement {
        return gridCanvas({
            cells: CELLS,
            renderItem: () => div({className: 'test-body'}),
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
