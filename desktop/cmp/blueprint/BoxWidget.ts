import {box, frame} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses} from '@xh/hoist/core';
import {BlueprintWidgetModel, type BoxWidgetConfig} from '../../../blueprint';
import {layoutChildren} from './impl/layout';

/** The `box` widget: its children in a row or a column, each sized by its child reference. */
export class BoxWidgetModel extends BlueprintWidgetModel<BoxWidgetConfig> {}

export const [BoxWidget, boxWidget] = hoistCmp.withFactory({
    displayName: 'BoxWidget',
    className: 'xh-blueprint-box',
    model: uses(BoxWidgetModel),
    render({model, className}) {
        const {direction = 'column', fill = true, gap, align = 'stretch'} = model.resolvedConfig;
        return (fill ? frame : box)({
            className,
            flexDirection: direction,
            gap: gap ?? null,
            alignItems: ALIGN[align],
            children: layoutChildren(model, direction)
        });
    }
});

const ALIGN = {stretch: 'stretch', start: 'flex-start', center: 'center', end: 'flex-end'};
