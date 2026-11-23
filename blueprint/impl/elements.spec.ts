import {describe, expect, it} from 'vitest';
import type {BlueprintElement} from '../Blueprint';
import {
    childGroups,
    childIds,
    insertRef,
    locate,
    parentOf,
    removeRef,
    slotLists,
    viewTitle
} from './elements';

/**
 * An element holds its children in slot lists: `children`, and others a widget names, such as a
 * panel's `tbar`, on the element itself or on a child reference, such as a dashboard cell's
 * `headerItems`. Every element but the root sits in exactly one slot list of one parent.
 */
describe('element slots', () => {
    const elements: Record<string, BlueprintElement> = {
        page: {
            component: 'panel',
            children: [{id: 'canvas'}],
            tbar: [{id: 'bar'}],
            personalizable: ['/config/title']
        } as BlueprintElement,
        canvas: {
            component: 'dashboard',
            children: [{id: 'grid', x: 0, y: 0, w: 6, h: 4, headerItems: [{id: 'views'}]}]
        },
        bar: {component: 'toolbar', children: []},
        grid: {component: 'cubeGrid'},
        views: {component: 'presetSelector'}
    };

    it("lists an element's slots, its own and its child references', and every child in them", () => {
        expect(slotLists(elements.page).map(it => [it.slot, it.of ?? null])).toEqual([
            ['children', null],
            ['tbar', null]
        ]);
        expect(slotLists(elements.canvas).map(it => [it.slot, it.of ?? null])).toEqual([
            ['children', null],
            ['headerItems', 'grid']
        ]);
        expect(childIds(elements.canvas)).toEqual(['grid', 'views']);
    });

    it("groups an element's own children as a designer reads them: by slot where its widget has several", () => {
        const panelSpec = {children: {}, slots: {tbar: {}, bbar: {}}},
            groups = (el: BlueprintElement, spec: object) =>
                childGroups('el', el, spec).map(it => [it.slot, it.refs.map(ref => ref.id)]);
        expect(groups(elements.page, panelSpec)).toEqual([
            ['children', ['canvas']],
            ['tbar', ['bar']],
            ['bbar', []]
        ]);
        // One group where the widget has one slot, without the slots of its cells.
        expect(groups(elements.canvas, {children: {slots: {headerItems: {}}}})).toEqual([
            ['children', ['grid']]
        ]);
        expect(groups(elements.grid, {})).toEqual([]);
    });

    it("lists a dashboard's cells and a panes widget's views as view nodes, each over its element and its own slots", () => {
        const dashboardSpec = {children: {slots: {headerItems: {}}}};
        expect(childGroups('canvas', elements.canvas, dashboardSpec)[0].nodes).toEqual([
            {
                kind: 'view',
                id: 'grid',
                of: 'canvas',
                groups: [
                    {slot: 'children', refs: [{id: 'grid'}]},
                    {slot: 'headerItems', refs: [{id: 'views'}]}
                ]
            }
        ]);
        const dock: BlueprintElement = {
            component: 'panes',
            children: [{id: 'a', title: 'Risk'}, {id: 'b'}]
        };
        expect(childGroups('dock', dock, {children: {}})[0].nodes).toEqual([
            {kind: 'view', id: 'a', of: 'dock', groups: [{slot: 'children', refs: [{id: 'a'}]}]},
            {kind: 'view', id: 'b', of: 'dock', groups: [{slot: 'children', refs: [{id: 'b'}]}]}
        ]);
        // Any other container lists its children as elements.
        expect(childGroups('page', elements.page, {children: {}})[0].nodes).toEqual([
            {kind: 'element', id: 'canvas'},
            {kind: 'element', id: 'bar'}
        ]);
    });

    it("titles a view by its reference's title, else its element's, else the element's ID", () => {
        expect(viewTitle({id: 'a', title: 'Risk'}, {component: 'panel'})).toBe('Risk');
        expect(viewTitle({id: 'a'}, {component: 'panel', config: {title: 'P&L'}})).toBe('P&L');
        expect(viewTitle({id: 'a', title: ''}, {component: 'panel'})).toBe('a');
        expect(viewTitle({id: 'a'}, null)).toBe('a');
    });

    it("lists a dashboard's cells in reading order, top to bottom, then left to right", () => {
        const canvas: BlueprintElement = {
            component: 'dashboard',
            children: [
                {id: 'c', x: 6, y: 4},
                {id: 'b', x: 6, y: 0},
                {id: 'a', x: 0, y: 0},
                {id: 'd', x: 0, y: 4}
            ]
        };
        expect(childGroups('canvas', canvas, {children: {}})[0].refs.map(it => it.id)).toEqual([
            'a',
            'b',
            'd',
            'c'
        ]);
    });

    it('finds the parent and the slot that hold an element', () => {
        expect(parentOf(elements, 'bar')).toBe('page');
        expect(parentOf(elements, 'views')).toBe('canvas');
        expect(locate(elements, 'views')).toEqual({
            parent: 'canvas',
            slot: 'headerItems',
            of: 'grid',
            index: 0
        });
        expect(locate(elements, 'page')).toBeNull();
    });

    it('removes a reference from whichever slot holds it, and inserts one into a slot', () => {
        const canvas = structuredClone(elements.canvas);
        expect(removeRef(canvas, 'views')).toEqual({id: 'views'});
        expect(canvas.children[0]).not.toHaveProperty('headerItems');
        insertRef(canvas, {id: 'views'}, {slot: 'headerItems', of: 'grid'});
        insertRef(canvas, {id: 'other'}, {slot: 'headerItems', of: 'grid', index: 0});
        expect((canvas.children[0].headerItems as any[]).map(it => it.id)).toEqual([
            'other',
            'views'
        ]);

        const page = structuredClone(elements.page);
        insertRef(page, {id: 'foot'}, {slot: 'bbar'});
        expect(page.bbar).toEqual([{id: 'foot'}]);
    });
});
