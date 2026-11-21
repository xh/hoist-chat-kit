import type {PlainObject} from '@xh/hoist/core';
import type {View} from '@xh/hoist/data';
import {observableRef} from '@xh/hoist/mobx';
import {
    type BlueprintSource,
    type BlueprintWidgetConfig,
    BlueprintWidgetModel
} from '../../../../blueprint';
import {variableText} from '../../../../blueprint/impl/variableText';
import {formatValue, resolveFormat} from '../../../../blueprint/impl/formats';
import type {ChatMarkdownProps} from '../../../../cmp/markdown';
import {
    fillTemplate,
    markdownTemplate,
    type TemplateRef
} from '../../../../blueprint/impl/template';
import {rehypeTemplateValues} from './rehypeTemplateValues';

/**
 * A widget whose config holds templates, such as `markdown`. It reads the root aggregates of each
 * source its templates name, through a View of its own over each one.
 */
export class TemplateWidgetModel<
    C extends PlainObject = PlainObject
> extends BlueprintWidgetModel<C> {
    @observableRef private accessor views: Record<string, View> = {};
    private removeViews: (() => void)[] = [];

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        // Each source's Cube lives as long as the source, so a new source means new Views.
        this.addReaction({
            track: () => this.demandedSources(),
            run: () => this.syncViews(),
            equals: 'shallow',
            fireImmediately: true
        });
    }

    /** A plain text template from the config, with each reference replaced by its value. */
    fillText(text: string): string {
        return fillTemplate(text, ref => this.refValue(ref));
    }

    /** The props for `chatMarkdown` that render a markdown template from the config. */
    markdownProps(
        text: string
    ): Pick<ChatMarkdownProps, 'content' | 'markdownPlugins' | 'isStreaming'> {
        const {content, values} = markdownTemplate(text, ref => this.refValue(ref));
        return {
            content,
            markdownPlugins: {rehype: [[rehypeTemplateValues, {values}]]},
            isStreaming: this.isStreaming
        };
    }

    // A chat answer's host says which of its elements are still arriving.
    private get isStreaming(): boolean {
        const host = this.blueprintModel.hostContext as {isPartial?: (id: string) => boolean};
        return !!host?.isPartial?.(this.id);
    }

    override destroy() {
        this.clearViews();
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private get demand() {
        const spec = this.blueprintModel.registry.widgets[this.element?.component];
        return spec?.demand?.(this.resolvedConfig) ?? {};
    }

    private demandedSources(): BlueprintSource[] {
        return Object.keys(this.demand)
            .map(it => this.blueprintModel.getSource(it))
            .filter(Boolean);
    }

    private syncViews() {
        this.clearViews();
        const views: Record<string, View> = {};
        this.demandedSources().forEach(source => {
            const view = source.cube.createView({
                query: {dimensions: [], includeRoot: true},
                connect: true
            });
            views[source.name] = view;
            this.removeViews.push(
                source.addView(view, () => this.demand[source.name]?.fields ?? []),
                () => view.destroy()
            );
        });
        this.views = views;
    }

    private clearViews() {
        this.removeViews.forEach(it => it());
        this.removeViews = [];
    }

    private refValue({source, name}: TemplateRef): string {
        const {blueprintModel} = this;
        if (!source) {
            const variable = blueprintModel.getVariable(name);
            if (variable) return variableText(variable.value, variable.decl.type);
        }
        const sourceName = source ?? this.resolvedConfig.source,
            src = blueprintModel.getSource(sourceName),
            view = this.views[sourceName],
            def = src?.fields[name];
        if (!def || !view) return '';
        if (src.isWaiting || src.isLoading || !src.hasLoaded) return '…';
        const {catalog, blueprint} = blueprintModel,
            value = (view.result.rows[0] as PlainObject)?.[name],
            opts = resolveFormat(def, src.displayOf(name).formats, {catalog, blueprint});
        return String(formatValue(value, def, opts, catalog, true) ?? '');
    }
}
