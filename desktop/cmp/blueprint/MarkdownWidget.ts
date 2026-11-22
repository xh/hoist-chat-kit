import {hoistCmp, uses} from '@xh/hoist/core';
import {chatMarkdown} from '../../../cmp/markdown';
import type {MarkdownWidgetConfig} from '../../../blueprint';
import {clipFrame} from './impl/ClipFrame';
import {TemplateWidgetModel} from './impl/TemplateWidgetModel';

/** The `markdown` widget: its text template, filled and rendered as markdown. */
export class MarkdownWidgetModel extends TemplateWidgetModel<MarkdownWidgetConfig> {}

export const [MarkdownWidget, markdownWidget] = hoistCmp.withFactory({
    displayName: 'MarkdownWidget',
    className: 'xh-blueprint-markdown',
    model: uses(MarkdownWidgetModel),
    render({model, className}) {
        return clipFrame({
            textModel: model,
            className,
            children: chatMarkdown(model.markdownProps(model.resolvedConfig.text))
        });
    }
});
