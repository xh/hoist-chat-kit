import type {PlainObject} from '@xh/hoist/core';
import type {View} from '@xh/hoist/data';
import {action, compareStructural, computed, observable, observableRef} from '@xh/hoist/mobx';
import {
    DASHBOARD_GAP,
    DASHBOARD_ROW_HEIGHT,
    growCell
} from '../../../../blueprint/impl/dashboardCells';
import {parentOf} from '../../../../blueprint/impl/elements';
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

    /** How far the text runs past its frame, in pixels, as it last drew. */
    @observable accessor overflow = 0;

    @action
    setOverflow(px: number) {
        this.overflow = Math.max(0, Math.round(px));
    }

    /** True in design mode for clipped text in a dashboard cell, which can grow to show it all. */
    get canGrow(): boolean {
        return (
            this.overflow > 0 &&
            this.blueprintModel.mode === 'design' &&
            this.parentElement?.component === 'dashboard'
        );
    }

    /** Grow the text's dashboard cell by enough rows to show it all, and move the cells below down, in one edit. */
    makeTaller() {
        const parent = this.parentElement,
            dashboardId = parentOf(this.blueprintModel.blueprint.elements, this.id),
            rowStep =
                ((parent?.config?.rowHeight as number) ?? DASHBOARD_ROW_HEIGHT) +
                ((parent?.config?.margin as number[])?.[1] ?? DASHBOARD_GAP),
            rows = Math.ceil(this.overflow / rowStep);
        if (!this.canGrow || !rows) return;
        this.applyUserEdit(
            [
                {
                    op: 'set',
                    path: `/elements/${dashboardId}/children`,
                    value: growCell(parent.children, this.id, rows)
                }
            ],
            `${this.id}: make taller`
        );
    }

    /** A plain text template from the config, with each reference replaced by its value. */
    fillText(text: string): string {
        return fillTemplate(text, ref => this.refValue(ref));
    }

    /**
     * The props for `chatMarkdown` that render a markdown template from the config. They keep
     * their identity while the text and its values do, so the markdown parses again only then.
     */
    markdownProps(
        text: string
    ): Pick<ChatMarkdownProps, 'content' | 'markdownPlugins' | 'isStreaming'> {
        if (!this.template || this.template.text !== text) {
            this.template = {
                text,
                filled: computed(() => markdownTemplate(text, ref => this.refValue(ref)), {
                    equals: compareStructural
                })
            };
        }
        const {content, values} = this.template.filled.get();
        if (this.plugins?.values !== values) {
            this.plugins = {values, plugins: {rehype: [[rehypeTemplateValues, {values}]]}};
        }
        return {content, markdownPlugins: this.plugins.plugins, isStreaming: this.isStreaming};
    }

    // The template last filled, and the plugins for its values.
    private template: {text: string; filled: {get(): ReturnType<typeof markdownTemplate>}} = null;
    private plugins: {values: unknown; plugins: ChatMarkdownProps['markdownPlugins']} = null;

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
