import {act, fireEvent, render} from '@testing-library/react';
import {div} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    dockLayout,
    DockLayoutModel,
    type DockItem,
    type DockLayoutProps,
    tabIndexAt,
    withSizes,
    zoneAt
} from './index';

/**
 * A layout of splits and tab stacks, controlled by the tree it is given. It reports a finished
 * resize or move as one new tree, switches tabs as view state, and offers a keyboard path for
 * every move a drag makes.
 */
describe('dockLayout', () => {
    beforeAll(() => initTestAppAsync());

    const LAYOUT: DockItem[] = [
        {
            type: 'row',
            content: [
                {type: 'stack', width: 60, content: [view('positions'), view('orders')]},
                {type: 'stack', width: 40, content: [view('chart')]}
            ]
        }
    ];

    it('draws each stack as a tab list, showing its first view', () => {
        const {container} = renderLayout({});
        const tabs = [...container.querySelectorAll('[role=tab]')].map(it => it.textContent);
        expect(tabs).toEqual(['Positions', 'Orders', 'Chart']);
        expect(selected(container)).toEqual(['positions', 'chart']);
        expect(container.querySelector('.test-view-positions')).toBeTruthy();
        expect(container.querySelector('.test-view-orders')).toBeNull();
    });

    it('switches tabs as view state, keeping a shown view mounted', () => {
        const onChange = vi.fn(),
            {container} = renderLayout({onChange});
        fireEvent.click(tab(container, 'orders'));

        expect(selected(container)).toEqual(['orders', 'chart']);
        expect(container.querySelector('.test-view-orders')).toBeTruthy();
        expect(container.querySelector('.test-view-positions')).toBeTruthy();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('moves focus and the shown tab with the arrow keys, with one tab stop per stack', () => {
        const {container} = renderLayout({});
        expect(tab(container, 'positions').tabIndex).toBe(0);
        expect(tab(container, 'orders').tabIndex).toBe(-1);

        fireEvent.keyDown(tab(container, 'positions'), {key: 'ArrowRight'});

        expect(selected(container)).toEqual(['orders', 'chart']);
        expect(document.activeElement).toBe(tab(container, 'orders'));
    });

    it('reorders a tab with Alt+Up and Alt+Down, as one change, when editable', () => {
        const onChange = vi.fn(),
            {container} = renderLayout({onChange, editable: true});
        fireEvent.keyDown(tab(container, 'orders'), {key: 'ArrowUp', altKey: true});

        expect(onChange).toHaveBeenCalledTimes(1);
        const [layout, change] = onChange.mock.calls[0];
        expect(layout[0].content[0].content.map(it => it.id)).toEqual(['orders', 'positions']);
        expect(change).toEqual({kind: 'move', id: 'orders'});
    });

    it('stops a key it handles, so it never reaches the keys around it', () => {
        const outer = vi.fn(),
            {container} = renderLayout({editable: true});
        document.addEventListener('keydown', outer);
        onTestFinished(() => document.removeEventListener('keydown', outer));
        fireEvent.keyDown(tab(container, 'orders'), {key: 'ArrowUp', altKey: true});
        fireEvent.keyDown(tab(container, 'orders'), {key: 'ArrowLeft'});
        expect(outer).not.toHaveBeenCalled();
    });

    it('offers no reordering when not editable', () => {
        const onChange = vi.fn(),
            {container} = renderLayout({onChange});
        fireEvent.keyDown(tab(container, 'orders'), {key: 'ArrowUp', altKey: true});
        expect(onChange).not.toHaveBeenCalled();
        expect(tab(container, 'orders').getAttribute('draggable')).not.toBe('true');
    });

    it('reports which views no tab shows, for a selection to reveal', () => {
        const onHiddenChange = vi.fn(),
            {container} = renderLayout({onHiddenChange});
        expect(onHiddenChange).toHaveBeenLastCalledWith(['orders']);
        fireEvent.click(tab(container, 'orders'));
        expect(onHiddenChange).toHaveBeenLastCalledWith(['positions']);
    });

    it('shows the tab a host asks for', () => {
        const {container, rerender} = renderLayout({});
        rerender(layout({active: ['orders']}));
        expect(selected(container)).toEqual(['orders', 'chart']);
    });

    describe('drag', () => {
        function dragModel(props: Partial<DockLayoutProps>) {
            const model = new DockLayoutModel();
            onTestFinished(() => model.destroy());
            model.props = {layout: LAYOUT, renderView: () => null, viewTitle: () => null, ...props};
            return model;
        }

        it('drops a dragged view where it is over, as one change', () => {
            const onChange = vi.fn(),
                model = dragModel({onChange, editable: true});
            model.startDrag('chart');
            expect(model.dragOver({view: 'positions', zone: 'center'})).toBe(true);
            model.dropHere();

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange.mock.calls[0][1]).toEqual({kind: 'move', id: 'chart'});
            expect(model.dragging).toBeNull();
        });

        it('refuses a zone with nowhere to go, or one the host refuses, checking each once a drag', () => {
            const canMove = vi.fn(() => 'Not here.'),
                onChange = vi.fn(),
                model = dragModel({onChange, editable: true, canMove});
            model.startDrag('chart');
            expect(model.dragOver({view: 'chart', zone: 'left'})).toBe(false);
            expect(model.drop.refusal).toMatch(/nowhere/);

            expect(model.dragOver({view: 'positions', zone: 'right'})).toBe(false);
            model.dragOver({view: 'positions', zone: 'right'});
            expect(canMove).toHaveBeenCalledTimes(1);
            expect(model.drop.refusal).toBe('Not here.');

            model.dropHere();
            expect(onChange).not.toHaveBeenCalled();
        });

        it('makes no drop once the drag ends, as a cancel does', () => {
            const onChange = vi.fn(),
                model = dragModel({onChange, editable: true});
            model.startDrag('chart');
            model.dragOver({view: 'positions', zone: 'center'});
            model.endDrag();
            model.dropHere();
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe('geometry', () => {
        const RECT = {left: 100, top: 100, width: 400, height: 200} as DOMRect;

        it('picks an edge zone in a stack’s outer quarter, else the center', () => {
            expect(zoneAt(RECT, 300, 200)).toBe('center');
            expect(zoneAt(RECT, 120, 200)).toBe('left');
            expect(zoneAt(RECT, 480, 200)).toBe('right');
            expect(zoneAt(RECT, 300, 110)).toBe('top');
            expect(zoneAt(RECT, 300, 290)).toBe('bottom');
        });

        it('places a tab drop between the tabs it falls between', () => {
            const tabs = [
                {left: 0, width: 80},
                {left: 80, width: 80},
                {left: 160, width: 80}
            ] as DOMRect[];
            expect(tabIndexAt(tabs, 10)).toBe(0);
            expect(tabIndexAt(tabs, 100)).toBe(1);
            expect(tabIndexAt(tabs, 230)).toBe(3);
        });

        it('sets a split’s sizes by its path in the tree', () => {
            expect(withSizes(LAYOUT, [0], [70, 30])[0].content.map(it => it.width)).toEqual([
                70, 30
            ]);
        });
    });

    //------------------
    // Test support
    //------------------
    function view(id: string): DockItem {
        return {type: 'view', id};
    }

    function layout(props: Partial<DockLayoutProps>): ReactElement {
        return dockLayout({
            layout: LAYOUT,
            renderView: id => div({className: `test-view-${id}`}),
            viewTitle: id => id[0].toUpperCase() + id.slice(1),
            ...props
        }) as ReactElement;
    }

    function renderLayout(props: Partial<DockLayoutProps>) {
        let ret: ReturnType<typeof render>;
        act(() => {
            ret = render(layout(props));
        });
        onTestFinished(() => ret.unmount());
        return ret;
    }

    function tab(container: HTMLElement, id: string): HTMLElement {
        return container.querySelector(`[role=tab][data-dock-view="${id}"]`);
    }

    function selected(container: HTMLElement): string[] {
        return [...container.querySelectorAll('[role=tab][aria-selected=true]')].map(
            it => (it as HTMLElement).dataset.dockView
        );
    }
});
