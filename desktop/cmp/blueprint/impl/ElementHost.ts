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
        const notice = model.source?.isTooLarge
            ? 'This result has too many rows to show here.'
            : model.source?.isUnavailable
              ? 'The data for this answer is no longer available.'
              : null;
        if (notice) {
            return div({className: 'xh-blueprint-view__notice', role: 'note', children: notice});
        }
        if (!component) {
            return div({
                className: 'xh-blueprint-view__missing',
                children: `${model.element.component} has no desktop component yet.`
            });
        }
        // A widget that draws as a card in a reply has no height of its own as a panel there.
        const {blueprintModel} = model,
            spec = blueprintModel.registry.widgets[model.element.component],
            rows = spec?.size?.default?.h;
        if (
            blueprintModel.isAnswer &&
            spec?.presentations?.length &&
            rows &&
            blueprintModel.presentationOf(id) === 'panel'
        ) {
            return div({
                className: 'xh-blueprint-view__answer-panel',
                style: {height: rows * ANSWER_ROW_HEIGHT},
                children: component({model})
            });
        }
        return component({model});
    }
});

// The height of a dashboard row, so a panel in a reply is as tall as its default size there.
const ANSWER_ROW_HEIGHT = 50;
