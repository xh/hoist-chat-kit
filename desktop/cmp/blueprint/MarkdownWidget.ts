import {hoistCmp, uses} from '@xh/hoist/core';
import {chatMarkdown} from '../../../cmp/markdown';
import type {MarkdownWidgetConfig} from '../../../blueprint';
import {TemplateWidgetModel} from './impl/TemplateWidgetModel';

/** The `markdown` widget: its text template, filled and rendered as markdown. */
export class MarkdownWidgetModel extends TemplateWidgetModel<MarkdownWidgetConfig> {}

export const [MarkdownWidget, markdownWidget] = hoistCmp.withFactory({
    displayName: 'MarkdownWidget',
    className: 'xh-blueprint-markdown',
    model: uses(MarkdownWidgetModel),
    render({model, className}) {
        return chatMarkdown({className, ...model.markdownProps(model.resolvedConfig.text)});
    }
});
