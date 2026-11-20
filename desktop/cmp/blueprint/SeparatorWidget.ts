import {separator} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses} from '@xh/hoist/core';
import {BlueprintWidgetModel, type SeparatorWidgetConfig} from '../../../blueprint';

/** The `separator` widget: a rule across its parent, so vertical in a row box. */
export class SeparatorWidgetModel extends BlueprintWidgetModel<SeparatorWidgetConfig> {
    get isVertical(): boolean {
        const parent = this.parentElement;
        return (
            parent?.component === 'box' &&
            this.blueprintModel.resolve(parent.config?.direction) === 'row'
        );
    }
}

export const [SeparatorWidget, separatorWidget] = hoistCmp.withFactory({
    displayName: 'SeparatorWidget',
    className: 'xh-blueprint-separator',
    model: uses(SeparatorWidgetModel),
    render({model, className}) {
        return separator({
            className,
            vertical: model.isVertical,
            label: model.resolvedConfig.label
        });
    }
});
