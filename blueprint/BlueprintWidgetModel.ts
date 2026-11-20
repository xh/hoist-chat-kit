import {HoistModel, type PlainObject, XH} from '@xh/hoist/core';
import type {View} from '@xh/hoist/data';
import {computed} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import type {ReactNode} from 'react';
import type {BlueprintElement, BlueprintOp, ChildRef} from './Blueprint';
import type {BlueprintModel} from './BlueprintModel';
import type {BlueprintSource} from './BlueprintSource';
import type {BlueprintVariable} from './BlueprintVariable';
import {parentOf} from './impl/elements';

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

    /** The element's config, with each binding replaced by its variable's current value. */
    @computed
    get resolvedConfig(): C {
        return this.blueprintModel.resolve(this.element?.config ?? {});
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
        if (error) XH.dangerToast(error.message);
        return !error;
    }

    /**
     * Set a value in the element's config, as {@link applyUserEdit}. `path` is inside the config.
     * A path that a preset group controls changes its active preset instead.
     */
    setConfig(path: string, value: unknown): boolean {
        // In design mode, a path that presets control changes the active preset.
        const target = this.blueprintModel.writePathFor(`/elements/${this.id}/config${path}`);
        return this.applyUserEdit(
            [{op: 'set', path: target, value}],
            `${this.id}: ${path.slice(1)}`
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
