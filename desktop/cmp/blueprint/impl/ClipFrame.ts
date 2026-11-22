import {box, div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {useOnResize} from '@xh/hoist/utils/react';
import {type ReactNode, useLayoutEffect, useRef} from 'react';
import type {TemplateWidgetModel} from './TemplateWidgetModel';

/**
 * Text that measures how far it runs past its frame. In design mode, clipped text in a canvas cell
 * shows a fade and a chip that grows the cell to show it all.
 */
export const clipFrame = hoistCmp.factory<
    HoistProps & {textModel: TemplateWidgetModel; children: ReactNode}
>({
    displayName: 'BlueprintClipFrame',
    model: false,
    render({textModel, children, className}) {
        const ref = useRef<HTMLDivElement>(null),
            measure = () => {
                const el = ref.current;
                if (el) textModel.setOverflow(el.scrollHeight - el.clientHeight);
            },
            resizeRef = useOnResize(measure);
        // Again after each draw, as new text can overflow with no resize.
        useLayoutEffect(measure);
        return box({
            className: 'xh-blueprint-clip-frame',
            ref: resizeRef,
            items: [
                div({
                    ref,
                    className: `xh-blueprint-clip-frame__content ${className ?? ''}`,
                    children
                }),
                textModel.canGrow
                    ? div({
                          className: 'xh-blueprint-clip-frame__fade',
                          item: button({
                              className: 'xh-blueprint-clip-frame__grow',
                              text: 'Content clipped · make taller',
                              minimal: true,
                              onClick: () => textModel.makeTaller()
                          })
                      })
                    : null
            ]
        });
    }
});
