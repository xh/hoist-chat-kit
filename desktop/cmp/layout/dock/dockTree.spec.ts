import {describe, expect, it} from 'vitest';
import {insertView, moveView, stacksOf, type DockItem} from './dockTree';

/**
 * Docking as pure operations on a layout tree of splits, stacks and views: a view joins a stack,
 * splits one at an edge, or splits the whole layout. A stack left empty goes, a split left with
 * one child gives way to it, and every split's sizes still sum to 100.
 */
describe('dock tree', () => {
    // A row: positions and orders in one stack on the left, the chart alone on the right.
    const LAYOUT: DockItem[] = [
        {
            type: 'row',
            content: [
                {type: 'stack', width: 60, content: [view('positions'), view('orders')]},
                {type: 'stack', width: 40, content: [view('chart')]}
            ]
        }
    ];

    it('adds a view to a stack as its last tab, from the center zone', () => {
        expect(moveView(LAYOUT, 'chart', {view: 'positions', zone: 'center'})).toEqual([
            {type: 'stack', content: [view('positions'), view('orders'), view('chart')]}
        ]);
    });

    it('puts a view at an index in a tab strip, within its own stack too', () => {
        expect(ids(moveView(LAYOUT, 'chart', {view: 'positions', zone: 'tab', index: 1}))).toEqual([
            ['positions', 'chart', 'orders']
        ]);
        expect(ids(moveView(LAYOUT, 'orders', {view: 'positions', zone: 'tab', index: 0}))).toEqual(
            [['orders', 'positions'], ['chart']]
        );
    });

    it('splits a stack at an edge along its split, halving its share', () => {
        expect(moveView(LAYOUT, 'orders', {view: 'chart', zone: 'right'})).toEqual([
            {
                type: 'row',
                content: [
                    {type: 'stack', width: 60, content: [view('positions')]},
                    {type: 'stack', width: 20, content: [view('chart')]},
                    {type: 'stack', width: 20, content: [view('orders')]}
                ]
            }
        ]);
    });

    it('splits a stack across its split into a new one, which takes the stack’s share', () => {
        expect(moveView(LAYOUT, 'orders', {view: 'chart', zone: 'bottom'})).toEqual([
            {
                type: 'row',
                content: [
                    {type: 'stack', width: 60, content: [view('positions')]},
                    {
                        type: 'column',
                        width: 40,
                        content: [
                            {type: 'stack', height: 50, content: [view('chart')]},
                            {type: 'stack', height: 50, content: [view('orders')]}
                        ]
                    }
                ]
            }
        ]);
    });

    it('splits the whole layout at a root edge, giving the new side a third', () => {
        expect(moveView(LAYOUT, 'orders', {zone: 'root-top'})).toEqual([
            {
                type: 'column',
                content: [
                    {type: 'stack', height: 33.33, content: [view('orders')]},
                    {
                        type: 'row',
                        height: 66.67,
                        content: [
                            {type: 'stack', width: 60, content: [view('positions')]},
                            {type: 'stack', width: 40, content: [view('chart')]}
                        ]
                    }
                ]
            }
        ]);
        const left = moveView(LAYOUT, 'orders', {zone: 'root-left'})[0];
        expect(left.content.map(it => it.width)).toEqual([33.33, 40, 26.67]);
    });

    it('removes a stack a move empties, and gives its share to the rest', () => {
        const three: DockItem[] = [
            {
                type: 'row',
                content: [
                    {type: 'stack', width: 50, content: [view('a')]},
                    {type: 'stack', width: 25, content: [view('b')]},
                    {type: 'stack', width: 25, content: [view('c')]}
                ]
            }
        ];
        expect(moveView(three, 'b', {view: 'a', zone: 'center'})).toEqual([
            {
                type: 'row',
                content: [
                    {type: 'stack', width: 66.67, content: [view('a'), view('b')]},
                    {type: 'stack', width: 33.33, content: [view('c')]}
                ]
            }
        ]);
    });

    it('leaves a view moved onto its own stack where it is, and refuses one with nowhere to go', () => {
        expect(stacksOf(moveView(LAYOUT, 'chart', {view: 'chart', zone: 'left'}))).toEqual(
            stacksOf(LAYOUT)
        );
        expect(stacksOf(moveView(LAYOUT, 'chart', {view: 'chart', zone: 'center'}))).toEqual(
            stacksOf(LAYOUT)
        );
        expect(moveView(LAYOUT, 'nothing', {view: 'chart', zone: 'left'})).toBeNull();
        expect(moveView(LAYOUT, 'chart', {view: 'nothing', zone: 'left'})).toBeNull();
    });

    it('inserts a new view where a move would put it', () => {
        expect(insertView(LAYOUT, 'news', {view: 'chart', zone: 'center'})).toEqual([
            {
                type: 'row',
                content: [
                    {type: 'stack', width: 60, content: [view('positions'), view('orders')]},
                    {type: 'stack', width: 40, content: [view('chart'), view('news')]}
                ]
            }
        ]);
        expect(stacksOf(insertView(LAYOUT, 'news', {view: 'positions', zone: 'left'}))).toEqual([
            ['news'],
            ['positions', 'orders'],
            ['chart']
        ]);
        expect(stacksOf(insertView([], 'news', {zone: 'root-left'}))).toEqual([['news']]);
    });

    it('refuses to insert a view the layout already holds, or at a target it lacks', () => {
        expect(insertView(LAYOUT, 'chart', {view: 'positions', zone: 'center'})).toBeNull();
        expect(insertView(LAYOUT, 'news', {view: 'nothing', zone: 'center'})).toBeNull();
    });

    it('lists each stack by its views, for a move-to menu', () => {
        expect(stacksOf(LAYOUT)).toEqual([['positions', 'orders'], ['chart']]);
    });

    //------------------
    // Test support
    //------------------
    function view(id: string): DockItem {
        return {type: 'view', id};
    }

    function ids(layout: DockItem[]): string[][] {
        return stacksOf(layout);
    }
});
