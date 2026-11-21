import classNames from 'classnames';
import {div} from '@xh/hoist/cmp/layout';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import type {BlueprintViewModel} from './BlueprintViewModel';
import {missingModules} from './highchartsModules';

const listOf = (items: string[]) =>
    items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0];

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
        const content = renderContent(id, viewModel),
            {designModel} = viewModel;
        if (!designModel || viewModel.blueprintModel.mode !== 'design') return content;
        // The innermost element under a click is the one it selects.
        return div({
            className: classNames(
                'xh-blueprint-view__design-element',
                designModel.selectedElementId === id &&
                    'xh-blueprint-view__design-element--selected'
            ),
            onClick: e => {
                const native = e.nativeEvent as MouseEvent & {xhSelected?: boolean};
                if (native.xhSelected) return;
                native.xhSelected = true;
                designModel.select({kind: 'element', id});
            },
            children: content
        });
    }
});

function renderContent(id: string, viewModel: BlueprintViewModel) {
    const model = viewModel.getWidgetModel(id),
        component = viewModel.getComponent(id);
    if (!model) return null;
    const spec = model.blueprintModel.registry.widgets[model.element.component],
        missing = missingModules(spec, model.resolvedConfig),
        notice = missing.length
            ? `This needs Highcharts' ${listOf(missing)} module${missing.length > 1 ? 's' : ''}, which this app does not load.`
            : model.source?.isTooLarge
              ? 'This result has too many rows to show here.'
              : model.source?.isUnavailable
                ? 'The data for this answer is no longer available.'
                : spec?.value && !model.valueVariable
                  ? `This ${spec.label} sets no variable yet. Pick one under Sets in the inspector.`
                  : (model.source?.joinWait ?? model.source?.selectionWait ?? null);
    if (notice) {
        return div({className: 'xh-blueprint-view__notice', role: 'note', children: notice});
    }
    if (!component) {
        return div({
            className: 'xh-blueprint-view__missing',
            children: `${model.element.component} has no desktop component yet.`
        });
    }
    // A widget that draws as a card in a reply has no height of its own as a panel there. It
    // takes the height of its content, up to that of its default size on a dashboard.
    const {blueprintModel} = model,
        rows = spec?.size?.default?.h;
    if (
        blueprintModel.isAnswer &&
        spec?.presentations?.length &&
        rows &&
        blueprintModel.presentationOf(id) === 'panel'
    ) {
        const height = Math.min(model.contentHeight ?? Infinity, rows * ANSWER_ROW_HEIGHT),
            title = blueprintModel.resolve(model.element.config?.title),
            hasTitle = title != null && title !== '';
        if (viewModel.framePanel) {
            return viewModel.framePanel({
                title: hasTitle ? String(title) : null,
                contentHeight: height,
                children: component({model})
            });
        }
        // A title draws in a header, as a dashboard's cell draws it, above the content.
        return panel({
            className: 'xh-blueprint-view__answer-panel',
            title: hasTitle ? String(title) : null,
            compactHeader: true,
            height: hasTitle ? `calc(${height}px + var(--xh-title-compact-height))` : height,
            width: '100%',
            flex: 'none',
            children: component({model})
        });
    }
    return component({model});
}

// The height of a dashboard row, so a panel in a reply is as tall as its default size there.
const ANSWER_ROW_HEIGHT = 50;
