import {elementFactory} from '@xh/hoist/core';
import {cloneElement, isValidElement, type ReactElement, type ReactNode} from 'react';
import type {Blueprint, BlueprintRegistry, WidgetGlyph, WidgetSpec} from '../../../blueprint';
import {getOwn} from '../../../blueprint/impl/pointer';
import {widgetIcon} from './design/impl/icons';
import './BlueprintPreview.scss';

/** The size of a blueprint schematic's viewBox, which its SVG scales to fill. */
export const SCHEMATIC_SIZE = {width: 160, height: 76};

/**
 * A widget's picture: its `preview` glyph as an SVG of the size given, which takes the theme's
 * colors. A widget with no preview, or one naming no kit glyph, shows its icon instead.
 */
export function widgetPreview(
    spec: Pick<WidgetSpec, 'preview' | 'icon' | 'category'>,
    size: {width: number; height: number} = {width: 120, height: 40}
): ReactElement {
    const shapes = glyphShapes(spec, size);
    if (!shapes) return widgetIcon(spec);
    return svg({
        className: 'xh-blueprint-preview',
        viewBox: `0 0 ${size.width} ${size.height}`,
        width: size.width,
        height: size.height,
        children: shapes
    });
}

/**
 * A schematic of a blueprint, drawn from its layout alone with no data: its first canvas, under
 * the first tab where the root holds tabs, with each cell at its place and its widget's glyph
 * inside. A blueprint with no canvas shows its root's glyph. The SVG fills its container.
 */
export function blueprintSchematic(
    blueprint: Blueprint,
    registry: BlueprintRegistry
): ReactElement {
    const {tabs, cells} = schematicLayout(blueprint),
        {width, height} = SCHEMATIC_SIZE;
    return svg({
        className: 'xh-blueprint-preview xh-blueprint-preview--schematic',
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'xMidYMid meet',
        children: [
            tabs
                ? rect({key: '_tabs', className: MID, x: 0, y: 0, width, height: TAB_STRIP, rx: 1})
                : null,
            ...cells.map(cell => {
                const spec = registry.widgets[cell.component],
                    inner = {width: cell.width - 2 * PAD, height: cell.height - 2 * PAD};
                return g({
                    key: cell.id,
                    transform: `translate(${cell.x} ${cell.y})`,
                    children: [
                        rect({
                            className: BG,
                            x: 0,
                            y: 0,
                            width: cell.width,
                            height: cell.height,
                            rx: 1
                        }),
                        inner.width > 0 && inner.height > 0
                            ? g({
                                  transform: `translate(${PAD} ${PAD})`,
                                  children: glyphShapes(spec, inner) ?? unknownShape(inner)
                              })
                            : null
                    ]
                });
            })
        ]
    });
}

/**
 * Where a schematic draws each cell, in the units of {@link SCHEMATIC_SIZE}, and whether it draws
 * a tab strip above them.
 * @internal
 */
export function schematicLayout(blueprint: Blueprint): {
    tabs: boolean;
    cells: {id: string; component: string; x: number; y: number; width: number; height: number}[];
} {
    const elements = blueprint?.elements ?? {},
        {width, height} = SCHEMATIC_SIZE;
    let id = blueprint?.root,
        tabs = false;
    // Down the first child of each container, to the first canvas.
    for (let depth = 0; depth < 6 && id; depth++) {
        const el = getOwn(elements, id);
        if (!el || el.component === 'dashCanvas') break;
        if (el.component === 'tabContainer') tabs = true;
        id = el.children?.[0]?.id ?? null;
    }
    const canvas = id ? getOwn(elements, id) : null,
        top = tabs ? TAB_STRIP + GAP : 0;
    if (canvas?.component !== 'dashCanvas') {
        const root = getOwn(elements, blueprint?.root);
        return {
            tabs: false,
            cells: root
                ? [{id: blueprint.root, component: root.component, x: 0, y: 0, width, height}]
                : []
        };
    }
    const refs = (canvas.children ?? []) as {
            id: string;
            x: number;
            y: number;
            w: number;
            h: number;
        }[],
        cols = (canvas.config?.columns as number) ?? 12,
        rows = Math.max(1, ...refs.map(it => it.y + it.h)),
        unitW = width / cols,
        unitH = (height - top) / rows;
    return {
        tabs,
        cells: refs
            .filter(it => getOwn(elements, it.id))
            .map(it => ({
                id: it.id,
                component: elements[it.id].component,
                x: it.x * unitW + GAP / 2,
                y: top + it.y * unitH + GAP / 2,
                width: it.w * unitW - GAP,
                height: it.h * unitH - GAP
            }))
    };
}

//------------------
// Implementation
//------------------
const svg = elementFactory('svg'),
    g = elementFactory('g'),
    rect = elementFactory('rect'),
    circle = elementFactory('circle'),
    line = elementFactory('line'),
    polyline = elementFactory('polyline'),
    path = elementFactory('path');

const FG = 'xh-blueprint-preview__fg',
    MID = 'xh-blueprint-preview__mid',
    BG = 'xh-blueprint-preview__bg',
    STROKE = 'xh-blueprint-preview__line',
    TAB_STRIP = 6,
    GAP = 4,
    PAD = 3;

// A kit glyph: shapes in a design box of its own, stretched to fill or fitted whole.
interface KitGlyph {
    box: [number, number];
    stretch?: boolean;
    draw: () => ReactNode[];
}

const bars = (xs: number[][], cls = FG) =>
    xs.map(([x, y, w, h], i) => rect({key: i, className: cls, x, y, width: w, height: h}));

const KIT_GLYPHS: Record<string, KitGlyph> = {
    grid: {
        box: [120, 40],
        stretch: true,
        draw: () =>
            bars(
                [
                    [0, 0, 120, 7],
                    [0, 11, 120, 5],
                    [0, 20, 120, 5],
                    [0, 29, 120, 5]
                ],
                MID
            )
    },
    chart: {
        box: [120, 40],
        stretch: true,
        draw: () =>
            bars([
                [8, 16, 14, 24],
                [30, 6, 14, 34],
                [52, 22, 14, 18],
                [74, 12, 14, 28],
                [96, 18, 14, 22]
            ])
    },
    stat: {
        box: [120, 40],
        draw: () => [
            ...bars([[4, 4, 36, 5]], MID),
            ...bars([[4, 15, 60, 18]]),
            polyline({key: 'trend', className: STROKE, points: '74,30 84,22 94,26 104,14 116,18'})
        ]
    },
    treemap: {
        box: [120, 40],
        stretch: true,
        draw: () => [
            rect({key: 0, className: FG, x: 0, y: 0, width: 70, height: 40, opacity: 0.8}),
            rect({key: 1, className: MID, x: 72, y: 0, width: 48, height: 24}),
            rect({key: 2, className: FG, x: 72, y: 26, width: 48, height: 14, opacity: 0.5})
        ]
    },
    heatmap: {
        box: [120, 40],
        stretch: true,
        draw: () =>
            [0.9, 0.3, 0.6, 0.2, 0.5, 0.8, 0.1, 0.7, 0.4, 0.6, 0.9, 0.3].map((opacity, i) =>
                rect({
                    key: i,
                    className: FG,
                    x: (i % 4) * 30,
                    y: Math.floor(i / 4) * 13.5,
                    width: 29,
                    height: 12.5,
                    opacity
                })
            )
    },
    gauge: {
        box: [80, 44],
        draw: () => [
            path({key: 'track', className: `${STROKE} ${MID}`, d: 'M 8 40 A 32 32 0 0 1 72 40'}),
            path({key: 'value', className: STROKE, d: 'M 8 40 A 32 32 0 0 1 52 10'})
        ]
    },
    table: {
        box: [120, 40],
        stretch: true,
        draw: () =>
            [0, 1, 2].flatMap(row => [
                rect({key: `l${row}`, className: MID, x: 0, y: 4 + row * 12, width: 40, height: 6}),
                rect({
                    key: `v${row}`,
                    className: FG,
                    x: 50,
                    y: 4 + row * 12,
                    width: 50,
                    height: 6,
                    opacity: 0.7
                })
            ])
    },
    text: {
        box: [120, 40],
        stretch: true,
        draw: () =>
            bars(
                [
                    [0, 4, 120, 5],
                    [0, 14, 120, 5],
                    [0, 24, 120, 5],
                    [0, 34, 70, 5]
                ],
                MID
            )
    },
    callout: {
        box: [120, 40],
        stretch: true,
        draw: () => [
            ...bars([[0, 0, 4, 40]]),
            ...bars(
                [
                    [10, 6, 100, 5],
                    [10, 17, 100, 5],
                    [10, 28, 60, 5]
                ],
                MID
            )
        ]
    },
    input: {
        box: [120, 24],
        draw: () => [
            rect({key: 'box', className: BG, x: 1, y: 1, width: 118, height: 22, rx: 3}),
            ...bars([[8, 9, 60, 6]], MID),
            polyline({key: 'caret', className: STROKE, points: '102,9 107,14 112,9'})
        ]
    },
    switch: {
        box: [60, 24],
        draw: () => [
            rect({key: 'pill', className: FG, x: 4, y: 2, width: 40, height: 20, rx: 10}),
            circle({key: 'knob', className: BG, cx: 34, cy: 12, r: 7})
        ]
    },
    slider: {
        box: [120, 24],
        draw: () => [
            line({key: 'track', className: `${STROKE} ${MID}`, x1: 4, y1: 12, x2: 116, y2: 12}),
            line({key: 'value', className: STROKE, x1: 4, y1: 12, x2: 70, y2: 12}),
            circle({key: 'thumb', className: FG, cx: 70, cy: 12, r: 6})
        ]
    },
    buttons: {
        box: [120, 24],
        draw: () => [
            ...bars([[0, 4, 38, 16]]),
            ...bars(
                [
                    [41, 4, 38, 16],
                    [82, 4, 38, 16]
                ],
                MID
            )
        ]
    },
    tiles: {
        box: [120, 40],
        stretch: true,
        draw: () =>
            [0, 1, 2, 3].map(i =>
                rect({key: i, className: BG, x: i * 30 + 1, y: 6, width: 28, height: 28, rx: 2})
            )
    },
    panel: {
        box: [120, 40],
        stretch: true,
        draw: () => [
            rect({key: 'body', className: BG, x: 0.5, y: 0.5, width: 119, height: 39, rx: 1}),
            ...bars([[0, 0, 120, 8]], MID)
        ]
    },
    tabs: {
        box: [120, 40],
        stretch: true,
        draw: () => [
            ...bars([[0, 0, 30, 6]]),
            ...bars(
                [
                    [34, 0, 30, 6],
                    [68, 0, 30, 6]
                ],
                MID
            ),
            rect({key: 'body', className: BG, x: 0.5, y: 9.5, width: 119, height: 30, rx: 1})
        ]
    },
    canvas: {
        box: [120, 40],
        stretch: true,
        draw: () =>
            [
                [0, 0, 78, 18],
                [81, 0, 39, 18],
                [0, 21, 39, 19],
                [42, 21, 78, 19]
            ].map(([x, y, w, h], i) =>
                rect({key: i, className: BG, x, y, width: w, height: h, rx: 1})
            )
    },
    box: {
        box: [120, 40],
        stretch: true,
        draw: () => [
            rect({
                key: 0,
                className: `${BG} xh-blueprint-preview__dashed`,
                x: 1,
                y: 1,
                width: 57,
                height: 38
            }),
            rect({
                key: 1,
                className: `${BG} xh-blueprint-preview__dashed`,
                x: 62,
                y: 1,
                width: 57,
                height: 38
            })
        ]
    },
    toolbar: {
        box: [120, 20],
        stretch: true,
        draw: () => [
            ...bars([[0, 0, 120, 20]], MID),
            ...bars([
                [4, 5, 24, 10],
                [32, 5, 24, 10]
            ])
        ]
    },
    separator: {
        box: [120, 12],
        stretch: true,
        draw: () => [line({key: 0, className: `${STROKE} ${MID}`, x1: 0, y1: 6, x2: 120, y2: 6})]
    },
    spacer: {
        box: [120, 12],
        stretch: true,
        draw: () => [
            rect({
                key: 0,
                className: `${BG} xh-blueprint-preview__dashed`,
                x: 1,
                y: 1,
                width: 118,
                height: 10
            })
        ]
    }
};

// Kit thumbnails, each picturing one choice of a property, as an x-thumbnails annotation names.
const T = 'xh-blueprint-preview';
const KIT_THUMBNAILS: Record<string, KitGlyph> = {
    'chart.line': {
        box: [60, 36],
        draw: () => [polyline({key: 0, className: STROKE, points: '4,28 16,18 28,22 40,10 56,14'})]
    },
    'chart.spline': {
        box: [60, 36],
        draw: () => [
            path({key: 0, className: STROKE, d: 'M4 28 C 14 8, 24 32, 34 16 S 50 6, 56 12'})
        ]
    },
    'chart.column': {
        box: [60, 36],
        draw: () =>
            bars([
                [6, 18, 9, 16],
                [19, 8, 9, 26],
                [32, 22, 9, 12],
                [45, 12, 9, 22]
            ])
    },
    'chart.bar': {
        box: [60, 36],
        draw: () =>
            bars([
                [4, 3, 40, 6],
                [4, 11, 52, 6],
                [4, 19, 24, 6],
                [4, 27, 34, 6]
            ])
    },
    'chart.area': {
        box: [60, 36],
        draw: () => [
            path({
                key: 0,
                className: FG,
                opacity: 0.35,
                d: 'M4 28 L16 18 L28 22 L40 10 L56 14 L56 34 L4 34 Z'
            }),
            polyline({key: 1, className: STROKE, points: '4,28 16,18 28,22 40,10 56,14'})
        ]
    },
    'chart.areaspline': {
        box: [60, 36],
        draw: () => [
            path({
                key: 0,
                className: FG,
                opacity: 0.35,
                d: 'M4 28 C 14 8, 24 32, 34 16 S 50 6, 56 12 L56 34 L4 34 Z'
            }),
            path({key: 1, className: STROKE, d: 'M4 28 C 14 8, 24 32, 34 16 S 50 6, 56 12'})
        ]
    },
    'chart.pie': {
        box: [60, 36],
        draw: () => [
            circle({key: 0, className: MID, cx: 30, cy: 18, r: 15}),
            path({key: 1, className: FG, d: 'M30 18 L30 3 A15 15 0 0 1 44 23 Z'})
        ]
    },
    'chart.scatter': {
        box: [60, 36],
        draw: () =>
            [
                [10, 26],
                [18, 14],
                [26, 22],
                [34, 9],
                [42, 18],
                [50, 12],
                [22, 30]
            ].map(([cx, cy], i) => circle({key: i, className: FG, cx, cy, r: 2.5}))
    },
    'chart.waterfall': {
        box: [60, 36],
        draw: () => [
            ...bars([
                [4, 14, 9, 20],
                [17, 8, 9, 6],
                [30, 8, 9, 10]
            ]),
            rect({key: 'neg', className: `${T}__neg`, x: 43, y: 18, width: 9, height: 8})
        ]
    },
    // A canvas's packing: cells drawn up to the top, to the left, or where they were put.
    'canvas.vertical': {
        box: [60, 36],
        draw: () =>
            bars([
                [2, 2, 26, 14],
                [32, 2, 26, 9],
                [2, 19, 26, 9],
                [32, 14, 26, 14]
            ])
    },
    'canvas.horizontal': {
        box: [60, 36],
        draw: () =>
            bars([
                [2, 2, 14, 18],
                [2, 23, 14, 11],
                [19, 2, 20, 11],
                [19, 16, 20, 18]
            ])
    },
    'canvas.free': {
        box: [60, 36],
        draw: () =>
            bars([
                [4, 3, 20, 10],
                [36, 2, 20, 12],
                [12, 21, 18, 12],
                [40, 20, 16, 13]
            ])
    },
    'summary.top': {
        box: [60, 36],
        draw: () => [
            ...bars([[0, 2, 60, 7]]),
            ...bars(
                [
                    [0, 12, 60, 5],
                    [0, 20, 60, 5],
                    [0, 28, 60, 5]
                ],
                MID
            )
        ]
    },
    'summary.bottom': {
        box: [60, 36],
        draw: () => [
            ...bars(
                [
                    [0, 2, 60, 5],
                    [0, 10, 60, 5],
                    [0, 18, 60, 5]
                ],
                MID
            ),
            ...bars([[0, 27, 60, 7]])
        ]
    },
    'summary.off': {
        box: [60, 36],
        draw: () =>
            bars(
                [
                    [0, 4, 60, 5],
                    [0, 13, 60, 5],
                    [0, 22, 60, 5],
                    [0, 31, 60, 5]
                ],
                MID
            )
    },
    'display.segmented': {
        box: [60, 36],
        draw: () => [
            rect({key: 0, className: BG, x: 2, y: 11, width: 56, height: 14, rx: 3}),
            rect({key: 1, className: FG, x: 4, y: 13, width: 17, height: 10, rx: 2})
        ]
    },
    'display.buttonGroup': {
        box: [60, 36],
        draw: () => [
            ...bars([[2, 11, 17, 14]]),
            ...bars(
                [
                    [22, 11, 17, 14],
                    [42, 11, 17, 14]
                ],
                MID
            )
        ]
    },
    'display.select': {
        box: [60, 36],
        draw: () => [
            rect({key: 0, className: BG, x: 2, y: 11, width: 56, height: 14, rx: 3}),
            ...bars([[7, 16, 26, 4]], MID),
            polyline({key: 'caret', className: STROKE, points: '46,15 50,19 54,15'})
        ]
    },
    'display.toggle': {
        box: [60, 36],
        draw: () => [
            rect({key: 0, className: FG, x: 16, y: 10, width: 28, height: 16, rx: 8}),
            circle({key: 1, className: BG, cx: 36, cy: 18, r: 6})
        ]
    },
    'direction.row': {
        box: [60, 36],
        draw: () =>
            [0, 1, 2].map(i =>
                rect({key: i, className: BG, x: 2 + i * 19, y: 6, width: 17, height: 24, rx: 2})
            )
    },
    'direction.column': {
        box: [60, 36],
        draw: () =>
            [0, 1, 2].map(i =>
                rect({key: i, className: BG, x: 6, y: 2 + i * 11, width: 48, height: 9, rx: 2})
            )
    },
    'color.linear': {
        box: [60, 36],
        draw: () =>
            [0.2, 0.4, 0.6, 0.8, 1].map((opacity, i) =>
                rect({
                    key: i,
                    className: FG,
                    x: 2 + i * 11.5,
                    y: 8,
                    width: 10.5,
                    height: 20,
                    opacity
                })
            )
    },
    'color.wash': {
        box: [60, 36],
        draw: () =>
            [0.1, 0.2, 0.3, 0.2, 0.15].map((opacity, i) =>
                rect({
                    key: i,
                    className: FG,
                    x: 2 + i * 11.5,
                    y: 8,
                    width: 10.5,
                    height: 20,
                    opacity
                })
            )
    },
    'color.none': {
        box: [60, 36],
        draw: () =>
            [0, 1, 2, 3, 4].map(i =>
                rect({key: i, className: MID, x: 2 + i * 11.5, y: 8, width: 10.5, height: 20})
            )
    },
    'color.diverging': {
        box: [60, 36],
        draw: () => [
            ...[1, 0.5].map((opacity, i) =>
                rect({
                    key: `n${i}`,
                    className: `${T}__neg`,
                    x: 2 + i * 11.5,
                    y: 8,
                    width: 10.5,
                    height: 20,
                    opacity
                })
            ),
            rect({key: 'mid', className: MID, x: 25, y: 8, width: 10.5, height: 20, opacity: 0.4}),
            ...[0.5, 1].map((opacity, i) =>
                rect({
                    key: `p${i}`,
                    className: FG,
                    x: 36.5 + i * 11.5,
                    y: 8,
                    width: 10.5,
                    height: 20,
                    opacity
                })
            )
        ]
    },
    'color.sequential': {
        box: [60, 36],
        draw: () =>
            [0.15, 0.35, 0.55, 0.75, 1].map((opacity, i) =>
                rect({
                    key: i,
                    className: FG,
                    x: 2 + i * 11.5,
                    y: 8,
                    width: 10.5,
                    height: 20,
                    opacity
                })
            )
    }
};

/**
 * A choice's thumbnail, as a property's `x-thumbnails` names it, such as `chart.line`: an SVG of the
 * size given that takes the theme's colors, or null for a name the kit has no drawing for.
 */
export function thumbnailPreview(
    name: string,
    size: {width: number; height: number} = {width: 60, height: 36}
): ReactElement {
    const glyph = name ? getOwn(KIT_THUMBNAILS, name) : null;
    if (!glyph) return null;
    return svg({
        className: 'xh-blueprint-preview',
        viewBox: `0 0 ${size.width} ${size.height}`,
        width: size.width,
        height: size.height,
        children: drawn(glyph, size)
    });
}

// The shapes of a widget's glyph in a box of the size given, or null for none.
function glyphShapes(
    spec: Pick<WidgetSpec, 'preview'>,
    size: {width: number; height: number}
): ReactNode {
    const {preview} = spec ?? {};
    if (typeof preview === 'function') return (preview as WidgetGlyph)(size);
    const glyph = typeof preview === 'string' ? getOwn(KIT_GLYPHS, preview) : null;
    return glyph ? drawn(glyph, size) : null;
}

// A kit drawing in a box of the size given: stretched to fill, or fitted whole.
function drawn(glyph: KitGlyph, size: {width: number; height: number}): ReactElement {
    const [w, h] = glyph.box;
    return svg({
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        viewBox: `0 0 ${w} ${h}`,
        preserveAspectRatio: glyph.stretch ? 'none' : 'xMidYMid meet',
        overflow: 'visible',
        // Keyed here, as a glyph joins shape lists that each count from 0.
        children: glyph
            .draw()
            .map((it, i) => (isValidElement(it) ? cloneElement(it, {key: i}) : it))
    });
}

// A cell whose widget has no glyph: a plain block.
function unknownShape(size: {width: number; height: number}) {
    return rect({
        className: MID,
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        rx: 1,
        opacity: 0.4
    });
}
