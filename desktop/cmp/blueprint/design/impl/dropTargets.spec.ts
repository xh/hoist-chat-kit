import {describe, expect, it, onTestFinished} from 'vitest';
import {BlueprintModel, type BlueprintElement} from '../../../../../blueprint';
import {portfolioCatalog, scenarioRegistry} from '../../../../../test/blueprintFixtures';
import {dropPlaceAt} from './dropTargets';

/**
 * Where a drag over a blueprint would drop: the deepest container under the pointer, and the place
 * among its children on its main axis, or that container's refusal, never an ancestor's place.
 */
describe('dropPlaceAt', () => {
    it('places between the children of a row box, by the pointer across it', () => {
        const {at} = setup({page: box('row', ['a', 'b', 'c']), ...leaves('a', 'b', 'c')});
        layOut('page', {x: 0, y: 0, width: 300, height: 100});
        layOut('a', {x: 0, y: 0, width: 100, height: 100});
        layOut('b', {x: 100, y: 0, width: 100, height: 100});
        layOut('c', {x: 200, y: 0, width: 100, height: 100});

        expect(at(20, 50, 'a').target).toEqual({container: 'page', index: 0});
        expect(at(160, 50, 'b').target).toEqual({container: 'page', index: 2});
        expect(at(290, 50, 'c')).toMatchObject({
            target: {container: 'page', index: 3},
            line: {axis: 'row', at: 300, from: 0, to: 100}
        });
        expect(at(110, 50, 'b').line).toMatchObject({axis: 'row', at: 100});
    });

    it('places between the children of a column box, by the pointer down it', () => {
        const {at} = setup({page: box('column', ['a', 'b']), ...leaves('a', 'b')});
        layOut('page', {x: 0, y: 0, width: 200, height: 200});
        layOut('a', {x: 0, y: 0, width: 200, height: 100});
        layOut('b', {x: 0, y: 100, width: 200, height: 100});

        expect(at(50, 160, 'b')).toMatchObject({
            target: {container: 'page', index: 2},
            line: {axis: 'column', at: 200, from: 0, to: 200}
        });
        expect(at(50, 40, 'a').target.index).toBe(0);
    });

    it('stacks a panel down, and lines a toolbar across', () => {
        const panel = setup({
            page: {component: 'panel', children: [{id: 'a'}, {id: 'b'}]},
            ...leaves('a', 'b')
        });
        layOut('page', {x: 0, y: 0, width: 200, height: 200});
        layOut('a', {x: 0, y: 0, width: 200, height: 100});
        layOut('b', {x: 0, y: 100, width: 200, height: 100});
        expect(panel.at(50, 120, 'b').line.axis).toBe('column');
        panel.cleanup();

        const bar = setup({
            page: box('column', ['tb']),
            tb: {component: 'toolbar', children: [{id: 'i1'}, {id: 'i2'}]},
            i1: {component: 'switchInput'},
            i2: {component: 'switchInput'}
        });
        layOut('page', {x: 0, y: 0, width: 300, height: 300});
        layOut('tb', {x: 0, y: 0, width: 300, height: 30});
        layOut('i1', {x: 0, y: 0, width: 50, height: 30});
        layOut('i2', {x: 50, y: 0, width: 50, height: 30});
        expect(bar.at(80, 10, 'i2')).toMatchObject({
            target: {container: 'tb', index: 2},
            line: {axis: 'row', at: 100}
        });
    });

    it('places among the tiles of a tile frame in reading order', () => {
        const {at} = setup({
            page: {component: 'tileFrame', children: [{id: 'a'}, {id: 'b'}, {id: 'c'}]},
            ...leaves('a', 'b', 'c')
        });
        layOut('page', {x: 0, y: 0, width: 200, height: 200});
        layOut('a', {x: 0, y: 0, width: 100, height: 100});
        layOut('b', {x: 100, y: 0, width: 100, height: 100});
        layOut('c', {x: 0, y: 100, width: 100, height: 100});

        expect(at(150, 50, 'b').target.index).toBe(2);
        expect(at(20, 150, 'c').target.index).toBe(2);
        expect(at(80, 150, 'c').target.index).toBe(3);
    });

    it('places a new tab between the tab buttons, or after the last over the body', () => {
        const {at, host} = setup({
            page: {
                component: 'tabContainer',
                children: [
                    {id: 'a', title: 'A'},
                    {id: 'b', title: 'B'}
                ]
            },
            ...leaves('a', 'b')
        });
        const page = host.querySelector<HTMLElement>('[data-blueprint-element="page"]'),
            strip = document.createElement('div');
        strip.setAttribute('role', 'tablist');
        ['a', 'b'].forEach((id, i) => {
            const tab = document.createElement('div');
            tab.setAttribute('role', 'tab');
            tab.dataset.tabId = id;
            tab.getBoundingClientRect = () =>
                ({
                    left: i * 80,
                    right: i * 80 + 80,
                    top: 0,
                    bottom: 30,
                    width: 80,
                    height: 30
                }) as DOMRect;
            strip.appendChild(tab);
        });
        page.prepend(strip);
        layOut('page', {x: 0, y: 0, width: 400, height: 300});
        layOut('a', {x: 0, y: 30, width: 400, height: 270});

        expect(at(100, 15, strip)).toMatchObject({
            target: {container: 'page', index: 1},
            line: {axis: 'row', at: 80, from: 0, to: 30}
        });
        expect(at(200, 150, 'page').target).toEqual({container: 'page', index: 2});
    });

    it('takes the deepest container, never the dragged element or anything inside it', () => {
        const {at} = setup({
            page: box('column', ['inner', 'x']),
            inner: box('row', ['a']),
            ...leaves('a', 'x')
        });
        layOut('page', {x: 0, y: 0, width: 200, height: 200});
        layOut('inner', {x: 0, y: 0, width: 200, height: 100});
        layOut('a', {x: 0, y: 0, width: 100, height: 100});
        layOut('x', {x: 0, y: 100, width: 200, height: 100});

        expect(at(50, 50, 'a').target.container).toBe('inner');
        expect(at(50, 30, 'a', {element: 'inner'}).target).toEqual({container: 'page', index: 0});
    });

    it("shows the deepest container's refusal, rather than an ancestor's place", () => {
        const {at} = setup(
            {page: box('column', ['tb']), tb: {component: 'toolbar', children: []}},
            target =>
                target.container === 'tb' ? 'A toolbar holds inputs and buttons only.' : null
        );
        layOut('page', {x: 0, y: 0, width: 300, height: 300});
        layOut('tb', {x: 0, y: 0, width: 300, height: 30});

        expect(at(100, 10, 'tb', {widget: 'cubeGrid'})).toMatchObject({
            target: {container: 'tb', index: 0},
            refusal: 'A toolbar holds inputs and buttons only.',
            pointer: {x: 100, y: 10}
        });
    });

    it('leaves a canvas or a dash container to place its own drops', () => {
        const {at} = setup({
            page: {component: 'dashCanvas', children: [{id: 'a', x: 0, y: 0, w: 6, h: 4}]},
            ...leaves('a')
        });
        layOut('page', {x: 0, y: 0, width: 600, height: 400});
        layOut('a', {x: 0, y: 0, width: 300, height: 200});
        expect(at(400, 300, 'page')).toMatchObject({target: {container: 'page'}, ownDrop: true});
    });

    //------------------
    // Test support
    //------------------
    function box(direction: 'row' | 'column', ids: string[]): BlueprintElement {
        return {
            component: 'box',
            config: {direction},
            children: ids.map(id => ({id}))
        } as BlueprintElement;
    }

    function leaves(...ids: string[]): Record<string, BlueprintElement> {
        return Object.fromEntries(ids.map(id => [id, {component: 'markdown', config: {text: id}}]));
    }

    function setup(
        elements: Record<string, BlueprintElement>,
        canDropAt: (target: {container: string}) => string = () => null
    ) {
        const model = new BlueprintModel({
                blueprint: {schema: {blueprint: 1}, root: 'page', elements},
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            host = document.createElement('div');
        document.body.appendChild(host);
        host.appendChild(wrap('page', elements));
        const cleanup = () => {
            host.remove();
            model.destroy();
        };
        onTestFinished(cleanup);
        return {
            cleanup,
            host,
            at: (
                x: number,
                y: number,
                over: string | Element,
                source: object = {widget: 'markdown'}
            ) => {
                const was = document.elementFromPoint;
                document.elementFromPoint = () =>
                    typeof over === 'string'
                        ? host.querySelector(`[data-blueprint-element="${over}"]`)
                        : over;
                try {
                    return dropPlaceAt(host, model, source as any, x, y, (_s, t) => canDropAt(t));
                } finally {
                    document.elementFromPoint = was;
                }
            }
        };
    }

    // Each element's wrapper, holding its children's, as ElementHost nests them.
    function wrap(id: string, elements: Record<string, BlueprintElement>): HTMLElement {
        const el = document.createElement('div');
        el.dataset.blueprintElement = id;
        (elements[id]?.children ?? []).forEach(it => el.appendChild(wrap(it.id, elements)));
        return el;
    }

    function layOut(
        id: string,
        {x, y, width, height}: {x: number; y: number; width: number; height: number}
    ) {
        const el = document.querySelector(`[data-blueprint-element="${id}"]`);
        el.getBoundingClientRect = () =>
            ({
                x,
                y,
                left: x,
                top: y,
                width,
                height,
                right: x + width,
                bottom: y + height
            }) as DOMRect;
    }
});
