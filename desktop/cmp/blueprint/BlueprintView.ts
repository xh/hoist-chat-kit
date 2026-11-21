import {hoistCmp, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {type BlueprintDesignModel, BlueprintModel} from '../../../blueprint';
import {blueprintToolbar} from './impl/BlueprintToolbar';
import {BlueprintViewModel} from './impl/BlueprintViewModel';
import {drillInDialog} from './impl/DrillIn';
import './BlueprintView.scss';

export interface BlueprintViewProps extends HoistProps<BlueprintModel> {
    /**
     * The designer's model. In design mode, a click on an element selects it in this model, and
     * the selected element shows an outline.
     */
    designModel?: BlueprintDesignModel;
}

/**
 * Renders a blueprint: a toolbar with an input for each prompted variable, over the blueprint's
 * root element. Each element renders with its widget's desktop component, and keeps its widget
 * model for its life.
 */
export const [BlueprintView, blueprintView] = hoistCmp.withFactory<BlueprintViewProps>({
    displayName: 'BlueprintView',
    className: 'xh-blueprint-view',
    model: uses(BlueprintModel),
    render({model, className, designModel}) {
        const impl = useLocalModel(() => new BlueprintViewModel(model, {designModel})),
            {drillIn} = model;
        return panel({
            className,
            tbar: blueprintToolbar({blueprintModel: model}),
            children: [
                impl.renderElement(model.blueprint?.root),
                // A popover drill-in draws at the control that opened it.
                drillIn && !drillIn.anchor
                    ? drillInDialog({key: JSON.stringify(drillIn), host: model, drillIn})
                    : null
            ]
        });
    }
});
