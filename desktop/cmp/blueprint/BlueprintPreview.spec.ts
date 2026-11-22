import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {createElement, type ReactElement} from 'react';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {loadBlueprint, scenarioRegistry} from '../../../test/blueprintFixtures';
import {
    blueprintSchematic,
    SCHEMATIC_SIZE,
    schematicLayout,
    widgetPreview
} from './BlueprintPreview';

/**
 * Pictures of widgets and blueprints, drawn from the registry and the layout alone, for Add tiles,
 * registry rows and library cards.
 */
describe('BlueprintPreview', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const registry = scenarioRegistry(),
        draw = (el: ReactElement) => render(el).container;

    it.each(Object.values(registry.widgets).filter(it => !it.reserved && !it.app))(
        'draws a glyph for the built-in $name',
        spec => {
            const svg = draw(widgetPreview(spec)).querySelector('svg.xh-blueprint-preview');
            expect(svg).not.toBeNull();
            expect(
                svg.querySelectorAll('rect, path, line, circle, polyline').length
            ).toBeGreaterThan(0);
        }
    );

    it("draws an app's own glyph at the size asked, and shows the icon for a widget with none", () => {
        const glyph = vi.fn(({width}) => createElement('rect', {width, height: 4})) as any,
            own = draw(widgetPreview({preview: glyph, category: 'data'}, {width: 80, height: 20}));
        expect(glyph).toHaveBeenCalledWith({width: 80, height: 20});
        expect(own.querySelector('svg.xh-blueprint-preview rect').getAttribute('width')).toBe('80');

        const plain = draw(widgetPreview({icon: 'gauge', category: 'data'}));
        expect(plain.querySelector('svg.xh-blueprint-preview')).toBeNull();
        expect(plain.querySelector('svg')).not.toBeNull();
    });

    it("lays out a blueprint's first canvas, under its first tab, cell by cell", () => {
        const bp = loadBlueprint('p3-morning-report.json'),
            canvasId = bp.elements[bp.root].children[0].id,
            refs = bp.elements[canvasId].children,
            {tabs, cells} = schematicLayout(bp);
        expect(tabs).toBe(true);
        expect(cells.map(it => it.id)).toEqual(refs.map(it => it.id));
        // Cells keep their order on the grid, and stay inside the schematic.
        cells.forEach(it => {
            expect(it.x).toBeGreaterThanOrEqual(0);
            expect(it.x + it.width).toBeLessThanOrEqual(SCHEMATIC_SIZE.width);
            expect(it.y + it.height).toBeLessThanOrEqual(SCHEMATIC_SIZE.height);
        });
        const [first, second] = refs,
            at = (id: string) => cells.find(it => it.id === id);
        if (first.y === second.y) expect(at(first.id).x).toBeLessThan(at(second.id).x);
    });

    it('scales a canvas to its columns and rows', () => {
        const bp: any = {
                root: 'c',
                elements: {
                    c: {
                        component: 'dashCanvas',
                        config: {columns: 4},
                        children: [
                            {id: 'a', x: 0, y: 0, w: 2, h: 1},
                            {id: 'b', x: 2, y: 0, w: 2, h: 2}
                        ]
                    },
                    a: {component: 'statCard'},
                    b: {component: 'chart'}
                }
            },
            {tabs, cells} = schematicLayout(bp);
        expect(tabs).toBe(false);
        expect(cells).toEqual([
            {id: 'a', component: 'statCard', x: 2, y: 2, width: 76, height: 34},
            {id: 'b', component: 'chart', x: 82, y: 2, width: 76, height: 72}
        ]);
    });

    it("draws a blueprint with no canvas as its root's glyph", () => {
        const bp: any = {root: 'g', elements: {g: {component: 'cubeGrid'}}};
        expect(schematicLayout(bp).cells).toEqual([
            {id: 'g', component: 'cubeGrid', x: 0, y: 0, ...SCHEMATIC_SIZE}
        ]);
    });

    it('renders a schematic with a tab strip and a framed glyph per cell', () => {
        const bp = loadBlueprint('p3-morning-report.json'),
            svg = draw(blueprintSchematic(bp, registry)).querySelector(
                'svg.xh-blueprint-preview--schematic'
            );
        expect(svg.getAttribute('viewBox')).toBe('0 0 160 76');
        expect(svg.querySelectorAll(':scope > g').length).toBe(schematicLayout(bp).cells.length);
        expect(svg.querySelector(':scope > rect.xh-blueprint-preview__mid')).not.toBeNull();
    });
});
