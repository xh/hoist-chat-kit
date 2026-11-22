import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {expectedGridHeight, useContentWidth} from '@xh/hoist/desktop/cmp/dash/canvas/DashCanvas';
import {
    gridBackground,
    type GridLayoutProps,
    type LayoutItem,
    reactGridLayout
} from '@xh/hoist/kit/react-grid-layout';
import {useOnResize} from '@xh/hoist/utils/react';
import classNames from 'classnames';
import {useState} from 'react';
import './GridCanvas.scss';
import {GridCanvasModel, type GridCanvasProps} from './GridCanvasModel';

const CLS = 'xh-layout-grid';

const RESIZE_HANDLES = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as const;

/**
 * A canvas of cells placed on a grid, which a user can move and resize when `editable`. It is
 * controlled: it draws the `cells` it is given and keeps no layout of its own. A finished move or
 * resize calls `onChange` once, and Esc cancels one in progress.
 * @internal
 */
export const gridCanvas = hoistCmp.factory<HoistProps & GridCanvasProps>({
    displayName: 'GridCanvas',
    className: CLS,
    model: false,
    render({
        className,
        cells,
        onChange,
        renderItem,
        renderHeader,
        renderGrip,
        frameProps,
        onDropOver,
        onDrop,
        editable = false,
        showGrid = false,
        columns = 12,
        rowHeight = 50,
        margin = [10, 10],
        containerPadding = margin
    }) {
        const impl = useLocalModel(() => new GridCanvasModel()),
            [width, widthRef] = useContentWidth(),
            [height, setHeight] = useState<number>(null),
            heightRef = useOnResize(rect => setHeight(rect.height), {debounce: 100});
        impl.setProps({cells, onChange});

        const gridConfig = {cols: columns, rowHeight, margin, containerPadding},
            rglProps: GridLayoutProps = {
                width,
                layout: impl.layout,
                gridConfig,
                compactor: impl.compactor,
                dragConfig: {
                    enabled: editable,
                    handle: `.${CLS}__header, .${CLS}__grip`,
                    cancel: 'button, input, select, textarea, .xh-button, [role=button]',
                    // Unbounded, so a cell can go below the others, into a new row.
                    bounded: false
                },
                resizeConfig: {enabled: editable, handles: editable ? RESIZE_HANDLES : []},
                dropConfig: {
                    enabled: editable && !!onDrop,
                    defaultItem: {w: Math.floor(columns / 3), h: Math.floor(columns / 3)},
                    onDragOver: onDropOver
                },
                onDragStart: (_layout, _old, item) => impl.startGesture(item?.i),
                onDragStop: (layout, _old, item) => impl.endGesture('move', item?.i, layout),
                onResizeStart: (_layout, _old, item) => impl.startGesture(item?.i),
                onResizeStop: (layout, _old, item) => impl.endGesture('resize', item?.i, layout),
                onDrop: (layout, item: LayoutItem, e) => {
                    if (item) {
                        const others = layout
                            .filter(it => it.i !== item.i)
                            .map(({i, x, y, w, h}) => ({id: i, x, y, w, h}));
                        onDrop?.(
                            {x: item.x, y: item.y, w: item.w, h: item.h},
                            others,
                            e as DragEvent
                        );
                    }
                    impl.endGesture('move', null, []);
                },
                innerRef: heightRef,
                children: cells.map(({id}) => {
                    const header = renderHeader?.(id),
                        grip = header == null ? renderGrip?.(id) : null;
                    return div({
                        key: id,
                        className: `${CLS}__frame`,
                        ...({'data-grid-item': id, ...frameProps?.(id)} as object),
                        children: [
                            header != null
                                ? div({
                                      key: 'header',
                                      className: `${CLS}__header`,
                                      children: header
                                  })
                                : null,
                            grip != null
                                ? div({key: 'grip', className: `${CLS}__grip`, children: grip})
                                : null,
                            div({key: 'body', className: `${CLS}__body`, children: renderItem(id)})
                        ]
                    });
                })
            },
            measured = width != null;

        return div({
            ref: widthRef,
            className: classNames(className, editable && `${className}--editable`),
            children: [
                // Until the width is measured, hold the expected height, so a scrollbar is
                // already there when it is measured and the cells lay out once.
                measured ? null : div({key: 'size', style: {height: expectedGridHeight(rglProps)}}),
                showGrid && measured
                    ? div({
                          key: 'background',
                          className: `${CLS}__background`,
                          children: gridBackground({
                              width,
                              height: height ?? expectedGridHeight(rglProps),
                              rows: 'auto',
                              ...gridConfig,
                              color: 'var(--xh-dash-canvas-grid-cell-color)',
                              borderRadius: 0,
                              // Clip to the grid: 'auto' rows round up, and a part row would overflow.
                              style: {height: height ?? expectedGridHeight(rglProps)}
                          })
                      })
                    : null,
                measured ? reactGridLayout({key: 'grid', ...rglProps}) : null
            ]
        });
    }
});
