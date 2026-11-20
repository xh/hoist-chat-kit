import {hoistCmp, uses} from '@xh/hoist/core';
import {toolbar} from '@xh/hoist/desktop/cmp/toolbar';
import {BlueprintWidgetModel, type ToolbarWidgetConfig} from '../../../blueprint';

/** The `toolbar` widget: a Hoist `Toolbar` of its children, in order. */
export class ToolbarWidgetModel extends BlueprintWidgetModel<ToolbarWidgetConfig> {}

export const [ToolbarWidget, toolbarWidget] = hoistCmp.withFactory({
    displayName: 'ToolbarWidget',
    className: 'xh-blueprint-toolbar',
    model: uses(ToolbarWidgetModel),
    render({model, className}) {
        return toolbar({
            className,
            vertical: !!model.resolvedConfig.vertical,
            enableOverflowMenu: model.resolvedConfig.overflowMenu ?? true,
            children: model.children.map(it => model.renderElement(it.id))
        });
    }
});
