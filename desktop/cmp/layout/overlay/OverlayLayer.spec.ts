import {act, render} from '@testing-library/react';
import {div} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {OVERLAY_LAYERS, OverlayModel, overlayHost, type OverlayMark} from './index';

/**
 * One layer above a scroll area, where callers draw marks over target elements: outlines, tags,
 * toolbars and drop previews. Marks are placed from their targets' rects, may draw outside them,
 * and follow layout changes and scrolling.
 */
describe('overlay layer', () => {
    beforeAll(() => initTestAppAsync());

    it('places a mark at its target, relative to the layer', () => {
        const {model, container} = setup();
        rect(container.querySelector('.test-host'), {x: 100, y: 50, width: 800, height: 600});
        rect(target(container, 'posGrid'), {x: 120, y: 80, width: 300, height: 200});
        mark(model, {key: 'sel', target: selector('posGrid')});

        expect(box(container, 'sel')).toEqual({left: 20, top: 30, width: 300, height: 200});
    });

    it('takes a target as a selector or an element', () => {
        const {model, container} = setup();
        rect(target(container, 'posGrid'), {x: 10, y: 10, width: 50, height: 40});
        mark(model, {key: 'byElement', target: target(container, 'posGrid')});
        mark(model, {key: 'bySelector', target: selector('posGrid')});

        expect(box(container, 'byElement')).toEqual(box(container, 'bySelector'));
    });

    it('gives each mark the layer size, so it can draw inside its target when there is no room', () => {
        const {model, container} = setup();
        rect(container.querySelector('.test-host'), {x: 0, y: 0, width: 800, height: 600});
        rect(target(container, 'posGrid'), {x: 0, y: 0, width: 300, height: 200});
        let seen = null;
        mark(model, {
            key: 'tag',
            target: selector('posGrid'),
            render: it => {
                seen = it;
                return null;
            }
        });

        expect(seen).toEqual({
            x: 0,
            y: 0,
            width: 300,
            height: 200,
            area: {width: 800, height: 600},
            roomAbove: 0
        });
    });

    it('draws marks outside the area, so nothing the area holds clips them', () => {
        const {model, container} = setup();
        rect(target(container, 'posGrid'), {x: 0, y: 0, width: 300, height: 200});
        mark(model, {key: 'sel', target: selector('posGrid')});
        expect(markEl(container, 'sel')).toBeTruthy();
        expect(container.contains(markEl(container, 'sel'))).toBe(false);
    });

    it('says how much room a target has above it, up to the top of the page', () => {
        const {model, container} = setup();
        rect(container.querySelector('.test-host'), {x: 0, y: 100, width: 800, height: 600});
        rect(target(container, 'posGrid'), {x: 0, y: 130, width: 300, height: 200});
        let seen = null;
        mark(model, {
            key: 'toolbar',
            target: selector('posGrid'),
            render: it => {
                seen = it;
                return null;
            }
        });
        expect(seen.y).toBe(30);
        expect(seen.roomAbove).toBe(130);
    });

    it('omits a mark whose target is scrolled out of the area', () => {
        const {model, container} = setup();
        rect(container.querySelector('.test-host'), {x: 0, y: 0, width: 800, height: 600});
        rect(target(container, 'posGrid'), {x: 0, y: 700, width: 300, height: 200});
        mark(model, {key: 'sel', target: selector('posGrid')});
        expect(markEl(container, 'sel')).toBeNull();
    });

    it('omits a mark whose target is gone or not shown', () => {
        const {model, container} = setup();
        mark(model, {key: 'gone', target: selector('nothing')});
        mark(model, {key: 'hidden', target: selector('posGrid')});

        expect(markEl(container, 'gone')).toBeNull();
        expect(markEl(container, 'hidden')).toBeNull();
    });

    it('moves its marks when told the layout changed', () => {
        const {model, container} = setup();
        rect(target(container, 'posGrid'), {x: 0, y: 0, width: 300, height: 200});
        mark(model, {key: 'sel', target: selector('posGrid')});

        rect(target(container, 'posGrid'), {x: 40, y: 0, width: 300, height: 200});
        act(() => model.layoutChanged());

        expect(box(container, 'sel').left).toBe(40);
    });

    it('moves its marks when anything inside the area scrolls', async () => {
        const {model, container} = setup();
        rect(target(container, 'posGrid'), {x: 0, y: 100, width: 300, height: 200});
        mark(model, {key: 'sel', target: selector('posGrid')});

        rect(target(container, 'posGrid'), {x: 0, y: 60, width: 300, height: 200});
        await act(async () => {
            container.querySelector('.test-scroll').dispatchEvent(new Event('scroll'));
            await nextFrame();
        });

        expect(box(container, 'sel').top).toBe(60);
    });

    it('lets pointer events through a mark unless it is interactive', () => {
        const {model, container} = setup();
        rect(target(container, 'posGrid'), {x: 0, y: 0, width: 300, height: 200});
        mark(model, {key: 'outline', target: selector('posGrid')});
        mark(model, {key: 'toolbar', target: selector('posGrid'), interactive: true});

        expect(markEl(container, 'outline').style.pointerEvents).toBe('none');
        expect(markEl(container, 'toolbar').style.pointerEvents).toBe('auto');
    });

    it('draws dock marks above design marks, whoever registered first', () => {
        const {model, container} = setup();
        rect(target(container, 'posGrid'), {x: 0, y: 0, width: 300, height: 200});
        mark(model, {key: 'preview', target: selector('posGrid'), layer: OVERLAY_LAYERS.dock});
        mark(model, {key: 'sel', target: selector('posGrid'), layer: OVERLAY_LAYERS.design});

        const z = (key: string) => Number(markEl(container, key).style.zIndex);
        expect(z('preview')).toBeGreaterThan(z('sel'));
    });

    it('stops drawing a source once it is removed', () => {
        const {model, container} = setup();
        rect(target(container, 'posGrid'), {x: 0, y: 0, width: 300, height: 200});
        const remove = mark(model, {key: 'sel', target: selector('posGrid')});

        act(() => remove());

        expect(markEl(container, 'sel')).toBeNull();
    });
});

//------------------
// Test support
//------------------
function setup() {
    const model = new OverlayModel();
    onTestFinished(() => model.destroy());
    const {container} = render(
        overlayHost({
            model,
            className: 'test-host',
            children: div({
                className: 'test-scroll',
                children: [
                    div({key: 'a', 'data-blueprint-element': 'posGrid'} as any),
                    div({key: 'b', 'data-blueprint-element': 'chart'} as any)
                ]
            })
        }) as ReactElement
    );
    return {model, container};
}

function mark(model: OverlayModel, spec: Partial<OverlayMark> & {key: string}) {
    let remove: () => void;
    act(() => {
        remove = model.addMarks(spec.key, () => [
            {render: () => div({className: 'test-mark'}), ...spec} as OverlayMark
        ]);
    });
    return remove;
}

function selector(id: string) {
    return `[data-blueprint-element="${id}"]`;
}

function target(container: HTMLElement, id: string): HTMLElement {
    return container.querySelector(selector(id));
}

// Marks draw in a portal on the page, outside the area.
function markEl(_container: HTMLElement, key: string): HTMLElement {
    return document.body.querySelector(`[data-overlay-mark="${key}"]`);
}

function box(container: HTMLElement, key: string) {
    const {left, top, width, height} = markEl(container, key).style;
    return {
        left: parseFloat(left),
        top: parseFloat(top),
        width: parseFloat(width),
        height: parseFloat(height)
    };
}

function rect(
    el: Element,
    {x, y, width, height}: {x: number; y: number; width: number; height: number}
) {
    el.getBoundingClientRect = () =>
        ({x, y, left: x, top: y, width, height, right: x + width, bottom: y + height}) as DOMRect;
}

function nextFrame() {
    return new Promise(resolve => window.requestAnimationFrame(() => resolve(null)));
}
