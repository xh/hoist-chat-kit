import {HoistModel, type PlainObject} from '@xh/hoist/core';
import type {View} from '@xh/hoist/data';
import {computed} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {set} from 'lodash';
import type {ReactNode} from 'react';
import {applyOps} from './applyOps';
import type {BlueprintElement, BlueprintOp, ChildRef} from './Blueprint';
import type {BlueprintModel} from './BlueprintModel';
import type {BlueprintSource} from './BlueprintSource';
import type {BlueprintVariable} from './BlueprintVariable';
import {parentOf} from './impl/elements';
import {templateStrings} from './impl/configSchema';
import {fitsProp} from './validateBlueprint';

export interface BlueprintWidgetConfig {
    blueprintModel: BlueprintModel;
    /** The element's ID in the blueprint. */
    id: string;
    /** Render another element, such as a container's child. */
    renderElement: (id: string) => ReactNode;
}

/**
 * The model of one element of a blueprint, held for the element's life. Derives its state from
 * the element's config, and reacts when the config changes. Changes the blueprint only through
 * edits, and publishes its outputs through the blueprint model.
 */
export class BlueprintWidgetModel<C extends PlainObject = PlainObject> extends HoistModel {
    readonly blueprintModel: BlueprintModel;
    readonly id: string;
    readonly renderElement: (id: string) => ReactNode;

    private removeView: () => void = null;

    constructor({blueprintModel, id, renderElement}: BlueprintWidgetConfig) {
        super();
        this.blueprintModel = blueprintModel;
        this.id = id;
        this.renderElement = renderElement;
    }

    /** The element as the blueprint declares it, or null once it is gone. */
    get element(): BlueprintElement {
        return this.blueprintModel.effective?.elements?.[this.id] ?? null;
    }

    /** The element's child references, in order. Empty for a widget that is not a container. */
    get children(): ChildRef[] {
        return this.element?.children ?? [];
    }

    /** The widget of another element, by its ID. */
    componentOf(id: string): string {
        return this.blueprintModel.effective?.elements?.[id]?.component ?? null;
    }

    /** The references in one of the element's slot lists, or in one of a child reference's. */
    slotRefs(slot: string, of?: string): ChildRef[] {
        const holder = of ? this.children.find(it => it.id === of) : this.element;
        return ((holder as PlainObject)?.[slot] as ChildRef[]) ?? [];
    }

    /** True in a canvas cell narrower than the widget's least width, which clips it. */
    get isTooNarrow(): boolean {
        const {blueprintModel} = this,
            elements = blueprintModel.blueprint?.elements,
            canvasId = parentOf(elements, this.id),
            index = elements?.[canvasId]?.children?.findIndex(it => it.id === this.id),
            path = `/elements/${canvasId}/children/${index}/w`;
        return blueprintModel.issues.some(it => it.code === 'layout.tooNarrow' && it.path === path);
    }

    /** The container that holds the element, or null for the root. */
    get parentElement(): BlueprintElement {
        const elements = this.blueprintModel.effective?.elements;
        return elements?.[parentOf(elements, this.id)] ?? null;
    }

    /**
     * The height in pixels that the widget's content needs, for a host that sizes it to fit, such
     * as a chat answer. Null if the widget cannot say, as by default.
     */
    get contentHeight(): number {
        return null;
    }

    /**
     * The element's config, with each binding replaced by its variable's current value, and each
     * title that reads variables filled.
     */
    @computed
    get resolvedConfig(): C {
        const {blueprintModel} = this,
            config = this.element?.config ?? {},
            schema = blueprintModel.registry.widgets[this.element?.component]?.config,
            props = schema?.properties as PlainObject,
            ret = blueprintModel.resolve(config);
        // A variable set from outside, such as by a URL parameter, may hold a value the prop
        // refuses: leave it out, so the widget takes its default.
        Object.keys(config).forEach(key => {
            if (config[key]?.$var && props?.[key] && !fitsProp(ret[key], props[key])) {
                delete ret[key];
            }
        });
        // Only literal titles fill, never a bound value. The resolved config is a copy.
        templateStrings(config, schema)
            .filter(it => it.mode === 'variables')
            .forEach(({text, path}) => set(ret, path, blueprintModel.fillVariables(text)));
        return ret;
    }

    /** The source the config names, if any. */
    get source(): BlueprintSource {
        return this.blueprintModel.getSource(this.element?.config?.source);
    }

    /**
     * Apply an edit made by a user's interaction with the widget. In run mode, the change stays
     * transient instead, until personalizations exist. If the blueprint refuses an edit, the user
     * sees why, and the caller returns the widget to the blueprint's state.
     *
     * @returns true if the edit applied.
     */
    applyUserEdit(ops: BlueprintOp[], description?: string): boolean {
        const {blueprintModel} = this;
        if (blueprintModel.mode === 'run') {
            ops.forEach(
                op => op.op === 'set' && blueprintModel.setTransientValue(op.path, op.value)
            );
            return true;
        }
        const {issues} = blueprintModel.applyEdit({author: 'user', ops, description}),
            error = issues.find(it => it.severity === 'error');
        if (error) blueprintModel.showRefusal(error);
        return !error;
    }

    /**
     * Why {@link applyUserEdit} would refuse these ops, or null if it would apply them, applying
     * nothing. Run mode refuses nothing, as its changes stay transient.
     */
    canApplyUserEdit(ops: BlueprintOp[]): string {
        const {blueprintModel} = this;
        if (blueprintModel.mode === 'run') return null;
        const {result, issue} = applyOps(blueprintModel.blueprint ?? {}, ops);
        if (issue) return issue.message;
        return blueprintModel.validate(result).find(it => it.severity === 'error')?.message ?? null;
    }

    /**
     * Set a value in the element's config, as {@link applyUserEdit}. `path` is inside the config.
     * A path that a preset group controls changes its active preset instead. `description` names
     * the edit for undo, by default the element and path.
     */
    setConfig(path: string, value: unknown, description?: string): boolean {
        // In design mode, a path that presets control changes the active preset.
        const target = this.blueprintModel.writePathFor(`/elements/${this.id}/config${path}`);
        return this.applyUserEdit(
            [{op: 'set', path: target, value}],
            description ?? `${this.id}: ${path.slice(1)}`
        );
    }

    /**
     * Register the View the widget shows its source through, so the source fetches server values
     * for the View's grouping sets. Replaces the View registered before, if any.
     */
    protected registerView(view: View) {
        this.removeView?.();
        this.removeView = view ? this.source?.addView(view, () => this.shownFields) : null;
    }

    /** The `default` its widget's config schema gives a property, for a config that leaves it unset. */
    configDefault(key: string): any {
        const spec = this.blueprintModel.registry.widgets[this.element?.component];
        return (spec?.config as PlainObject)?.properties?.[key]?.default;
    }

    /** The fields of its source that the widget shows, from its demand. */
    get shownFields(): string[] {
        const spec = this.blueprintModel.registry.widgets[this.element?.component];
        return spec?.demand?.(this.resolvedConfig)[this.element.config.source]?.fields ?? [];
    }

    override destroy() {
        this.removeView?.();
        super.destroy();
    }

    /**
     * The variable whose `setBy` names this element, so the widget shows and sets its value - see
     * the widget spec's `value`. Null if no variable names it.
     */
    get valueVariable(): BlueprintVariable {
        return (
            this.blueprintModel.variables.find(v =>
                v.writers.some(w => w.kind === 'element' && w.element === this.id)
            ) ?? null
        );
    }

    /** The current value of {@link valueVariable}. */
    get value(): unknown {
        return this.valueVariable?.value ?? null;
    }

    /** Set {@link valueVariable}, as a user changes the value the widget shows. */
    setValue(value: unknown) {
        const variable = this.valueVariable;
        throwIf(!variable, `No variable is set by element '${this.id}'.`);
        this.blueprintModel.noteUserAction();
        variable.set(value);
    }

    /** Publish the value of one of the widget's outputs. */
    setOutput(output: string, value: unknown) {
        this.blueprintModel.setOutput(this.id, output, value);
    }
}
