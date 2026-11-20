import {box} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses} from '@xh/hoist/core';
import {BlueprintWidgetModel, type SpacerWidgetConfig} from '../../../blueprint';

/** The `spacer` widget: empty room, which its parent sizes - see `layoutChildren()`. */
export class SpacerWidgetModel extends BlueprintWidgetModel<SpacerWidgetConfig> {}

export const [SpacerWidget, spacerWidget] = hoistCmp.withFactory({
    displayName: 'SpacerWidget',
    className: 'xh-blueprint-spacer',
    model: uses(SpacerWidgetModel),
    render({className}) {
        return box({className});
    }
});
