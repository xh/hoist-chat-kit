import {callout} from '@xh/hoist/cmp/callout';
import {hoistCmp, uses} from '@xh/hoist/core';
import {chatMarkdown} from '../../../cmp/markdown';
import type {CalloutWidgetConfig} from '../../../blueprint';
import {TemplateWidgetModel} from './impl/TemplateWidgetModel';

/** The `callout` widget: a Hoist `Callout` with its title and text templates filled. */
export class CalloutWidgetModel extends TemplateWidgetModel<CalloutWidgetConfig> {}

export const [CalloutWidget, calloutWidget] = hoistCmp.withFactory({
    displayName: 'CalloutWidget',
    className: 'xh-blueprint-callout',
    model: uses(CalloutWidgetModel),
    render({model, className}) {
        const {intent = 'primary', title, text} = model.resolvedConfig;
        return callout({
            className,
            intent: intent === 'none' ? null : intent,
            title: title ? model.fillText(title) : null,
            children: chatMarkdown(model.markdownProps(text))
        });
    }
});
