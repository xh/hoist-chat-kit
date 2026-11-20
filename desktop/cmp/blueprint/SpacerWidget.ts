import {box, filler} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses} from '@xh/hoist/core';
import {BlueprintWidgetModel, type SpacerWidgetConfig} from '../../../blueprint';

/**
 * The `spacer` widget: empty room. A box sizes it - see `layoutChildren()`. In a toolbar it sizes
 * itself, and with no size fills the room left.
 */
export class SpacerWidgetModel extends BlueprintWidgetModel<SpacerWidgetConfig> {}

export const [SpacerWidget, spacerWidget] = hoistCmp.withFactory({
    displayName: 'SpacerWidget',
    className: 'xh-blueprint-spacer',
    model: uses(SpacerWidgetModel),
    render({model, className}) {
        const parent = model.parentElement;
        if (parent?.component !== 'toolbar') return box({className});
        const {size} = model.resolvedConfig;
        if (!size) return filler({className: `${className} xh-blueprint-spacer--fill`});
        return box({className, flex: 'none', [parent.config?.vertical ? 'height' : 'width']: size});
    }
});
