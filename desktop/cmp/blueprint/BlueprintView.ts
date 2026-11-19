import {hoistCmp, useLocalModel, uses} from '@xh/hoist/core';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {BlueprintModel} from '../../../blueprint';
import {blueprintToolbar} from './impl/BlueprintToolbar';
import {BlueprintViewModel} from './impl/BlueprintViewModel';
import './BlueprintView.scss';

/**
 * Renders a blueprint: a toolbar with an input for each prompted variable, over the blueprint's
 * root element. Each element renders with its widget's desktop component, and keeps its widget
 * model for its life.
 */
export const [BlueprintView, blueprintView] = hoistCmp.withFactory({
    displayName: 'BlueprintView',
    className: 'xh-blueprint-view',
    model: uses(BlueprintModel),
    render({model, className}) {
        const impl = useLocalModel(() => new BlueprintViewModel(model));
        return panel({
            className,
            tbar: blueprintToolbar({blueprintModel: model}),
            children: impl.renderElement(model.blueprint?.root)
        });
    }
});
