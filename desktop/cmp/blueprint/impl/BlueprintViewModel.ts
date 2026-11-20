import {HoistModel, XH, type ElementFactory} from '@xh/hoist/core';
import type {ReactNode} from 'react';
import {
    type BlueprintDesignModel,
    BlueprintWidgetModel,
    type BlueprintModel,
    type WidgetSpec
} from '../../../../blueprint';
import {buttonGroupInputWidget, ButtonGroupInputWidgetModel} from '../ButtonGroupInputWidget';
import {buttonGroupWidget, ButtonGroupWidgetModel} from '../ButtonGroupWidget';
import {chartWidget, ChartWidgetModel} from '../ChartWidget';
import {cubeGridWidget, CubeGridWidgetModel} from '../CubeGridWidget';
import {dashCanvasWidget, DashCanvasWidgetModel} from '../DashCanvasWidget';
import {groupingChooserWidget, GroupingChooserWidgetModel} from '../GroupingChooserWidget';
import {statCardStripWidget, StatCardStripWidgetModel} from '../StatCardStripWidget';
import {tabContainerWidget, TabContainerWidgetModel} from '../TabContainerWidget';
import {elementHost} from './ElementHost';

/** The desktop model and component of each built-in widget, for specs that name neither. */
const DESKTOP_WIDGETS: Record<string, Pick<WidgetSpec, 'model' | 'component'>> = {
    buttonGroup: {model: ButtonGroupWidgetModel, component: buttonGroupWidget},
    buttonGroupInput: {model: ButtonGroupInputWidgetModel, component: buttonGroupInputWidget},
    chart: {model: ChartWidgetModel, component: chartWidget},
    cubeGrid: {model: CubeGridWidgetModel, component: cubeGridWidget},
    dashCanvas: {model: DashCanvasWidgetModel, component: dashCanvasWidget},
    groupingChooser: {model: GroupingChooserWidgetModel, component: groupingChooserWidget},
    statCardStrip: {model: StatCardStripWidgetModel, component: statCardStripWidget},
    tabContainer: {model: TabContainerWidgetModel, component: tabContainerWidget}
};

/**
 * Holds one widget model per element, for the element's life, so a widget keeps its model while
 * its config changes. Creates and destroys models as elements come and go, outside of rendering,
 * so a render only looks them up.
 */
/**
 * Draws a widget that sizes to its content outside a dashboard, as in a chat answer: its title, if
 * any, its content, and the height in pixels that the content takes. The host's own chrome, such as
 * a border and a header, adds to that height.
 */
export type BlueprintPanelFrame = (props: {
    title: string;
    contentHeight: number;
    children: ReactNode;
}) => ReactNode;

export class BlueprintViewModel extends HoistModel {
    readonly blueprintModel: BlueprintModel;
    /** How the host frames a panel in an answer. Null for a Hoist panel. */
    readonly framePanel: BlueprintPanelFrame;
    /** The designer's selection and changes, for an element to show and take in design mode. */
    readonly designModel: BlueprintDesignModel;
    private readonly widgets = new Map<string, {component: string; model: BlueprintWidgetModel}>();

    constructor(
        blueprintModel: BlueprintModel,
        opts: {framePanel?: BlueprintPanelFrame; designModel?: BlueprintDesignModel} = {}
    ) {
        super();
        this.blueprintModel = blueprintModel;
        this.designModel = opts.designModel ?? null;
        this.framePanel = opts.framePanel ?? null;
        // Registered before the widgets are made, so that it runs ahead of their reactions and
        // destroys a widget whose element is gone before the widget reacts to it.
        this.addReaction({
            track: () => this.blueprintModel.blueprint?.elements,
            run: () => this.syncWidgets()
        });
        // Synced now, not by fireImmediately, which MobX defers inside a batch such as a render.
        this.syncWidgets();
    }

    /** Render an element by ID, or nothing if the blueprint has no such element. */
    renderElement = (id: string): ReactNode =>
        id ? elementHost({key: id, id, blueprintViewModel: this}) : null;

    /** The model of an element's widget, or null if the blueprint has no such element. */
    getWidgetModel(id: string): BlueprintWidgetModel {
        return this.widgets.get(id)?.model ?? null;
    }

    /** The component factory of an element's widget, or null if this platform has none. */
    getComponent(id: string): ElementFactory {
        const elements = this.blueprintModel.blueprint?.elements,
            el = elements && Object.hasOwn(elements, id) ? elements[id] : null;
        if (!el) return null;
        const presentation = this.blueprintModel.presentationOf(id),
            drawn = this.blueprintModel.registry.widgets[el.component]?.presentations?.find(
                it => it.name === presentation
            );
        return drawn?.component ?? this.getSpec(el.component).component ?? null;
    }

    override destroy() {
        this.widgets.forEach(it => it.model.destroy());
        this.widgets.clear();
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private getSpec(component: string): Pick<WidgetSpec, 'model' | 'component'> {
        const spec = this.blueprintModel.registry.widgets[component];
        return {...DESKTOP_WIDGETS[component], ...pickDefined(spec)};
    }

    /** Create a model for each new element, and destroy each whose element is gone or changed. */
    private syncWidgets() {
        const elements = this.blueprintModel.blueprint?.elements ?? {};
        this.widgets.forEach(({component, model}, id) => {
            if (elements[id]?.component === component) return;
            XH.safeDestroy(model);
            this.widgets.delete(id);
        });
        Object.entries(elements).forEach(([id, el]) => {
            if (this.widgets.has(id)) return;
            const ModelClass = this.getSpec(el.component).model ?? BlueprintWidgetModel,
                model = new ModelClass({
                    blueprintModel: this.blueprintModel,
                    id,
                    renderElement: this.renderElement
                });
            this.widgets.set(id, {component: el.component, model});
        });
    }
}

function pickDefined(spec: WidgetSpec): Pick<WidgetSpec, 'model' | 'component'> {
    const ret: Pick<WidgetSpec, 'model' | 'component'> = {};
    if (spec?.model) ret.model = spec.model;
    if (spec?.component) ret.component = spec.component;
    return ret;
}
