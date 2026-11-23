import {tileFrame} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses} from '@xh/hoist/core';
import {BlueprintWidgetModel, type TileFrameWidgetConfig} from '../../../blueprint';
import {emptyContent} from './impl/layout';

/** The `tileFrame` widget: a Hoist `TileFrame` with a tile per child. */
export class TileFrameWidgetModel extends BlueprintWidgetModel<TileFrameWidgetConfig> {}

export const [TileFrameWidget, tileFrameWidget] = hoistCmp.withFactory({
    displayName: 'TileFrameWidget',
    className: 'xh-blueprint-tile-frame',
    model: uses(TileFrameWidgetModel),
    render({model, className}) {
        const {title, emptyText, ...layout} = model.resolvedConfig;
        return (
            emptyContent(model) ??
            tileFrame({
                className,
                ...layout,
                spacing: layout.spacing ?? model.configDefault('spacing'),
                children: model.children.map(it => model.renderElement(it.id))
            })
        );
    }
});
