import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import type {BlueprintViewModel} from './BlueprintViewModel';

interface ElementHostProps extends HoistProps {
    id: string;
    /** Not `viewModel`, which a `DashCanvasView` passes to its content as its own model. */
    blueprintViewModel: BlueprintViewModel;
}

/** Renders one element of a blueprint with its widget's component and model. */
export const [ElementHost, elementHost] = hoistCmp.withFactory<ElementHostProps>({
    displayName: 'BlueprintElementHost',
    model: false,
    render({id, blueprintViewModel: viewModel}) {
        const model = viewModel.getWidgetModel(id),
            component = viewModel.getComponent(id);
        if (!model) return null;
        if (model.source?.isTooLarge) {
            return div({
                className: 'xh-blueprint-view__too-large',
                role: 'note',
                children: 'This result has too many rows to show here.'
            });
        }
        if (!component) {
            return div({
                className: 'xh-blueprint-view__missing',
                children: `${model.element.component} has no desktop component yet.`
            });
        }
        return component({model});
    }
});
