import {hoistCmp, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {type AddPlace, type BlueprintDesignModel, BlueprintModel} from '../../../blueprint';
import {overlayHost} from '../layout/overlay';
import {designHotkeys} from './design/impl/designHotkeys';
import {BlueprintViewModel} from './impl/BlueprintViewModel';
import {drillInDialog} from './impl/DrillIn';
import './BlueprintView.scss';

export interface BlueprintViewProps extends HoistProps<BlueprintModel> {
    /**
     * The designer's model. In design mode, a click on an element selects it in this model, the
     * selected element shows an outline and a toolbar, and the design keys act on it.
     */
    designModel?: BlueprintDesignModel;

    /**
     * Open the host's Add for a place, from an empty container's button in design mode. The
     * container is selected first, so Add targets it.
     */
    onAddWidget?: (place: AddPlace) => void;

    /** Open the host's Architect, from an empty dashboard's button in design mode. */
    onAskArchitect?: () => void;
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
    render({model, className, designModel, onAddWidget, onAskArchitect}) {
        const impl = useLocalModel(
                () => new BlueprintViewModel(model, {designModel, onAddWidget, onAskArchitect})
            ),
            {drillIn} = model,
            isDesign = !!designModel && model.mode === 'design';
        return panel({
            className,
            // Bound in run mode too, where they do nothing, so switching modes remounts nothing.
            hotkeys: designModel ? designHotkeys(designModel, {fromWidgets: true}) : null,
            // Focusable, so the design keys work once a click selects an element.
            contentBoxProps: isDesign ? {tabIndex: 0} : null,
            children: [
                // A designer marks hover and selection in a layer over the blueprint, kept in run
                // mode too, so switching modes remounts nothing.
                designModel
                    ? overlayHost({
                          key: 'overlay',
                          model: impl.overlay,
                          children: impl.renderElement(model.blueprint?.root)
                      })
                    : impl.renderElement(model.blueprint?.root),
                // A popover drill-in draws at the control that opened it.
                drillIn && !drillIn.anchor
                    ? drillInDialog({key: JSON.stringify(drillIn), host: model, drillIn})
                    : null
            ]
        });
    }
});
