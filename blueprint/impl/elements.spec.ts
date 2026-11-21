import {describe, expect, it} from 'vitest';
import type {BlueprintElement} from '../Blueprint';
import {
    childIds,
    insertRef,
    locate,
    parentOf,
    removeRef,
    slotLists,
    upgradeSlots
} from './elements';

/**
 * An element holds its children in slot lists: `children`, and others a widget names, such as a
 * panel's `tbar`, on the element itself or on a child reference, such as a canvas cell's
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
            component: 'dashCanvas',
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

    it("moves a child reference's old slot marker into the slot list it names", () => {
        const old = {
                root: 'page',
                elements: {
                    page: {
                        component: 'panel',
                        children: [
                            {id: 'body'},
                            {id: 'top', slot: 'tbar'},
                            {id: 'foot', slot: 'bbar'}
                        ]
                    }
                }
            },
            upgraded = upgradeSlots(old as any);
        expect(upgraded.elements.page).toEqual({
            component: 'panel',
            children: [{id: 'body'}],
            tbar: [{id: 'top'}],
            bbar: [{id: 'foot'}]
        });
        expect(upgradeSlots(upgraded)).toBe(upgraded);
    });
});
