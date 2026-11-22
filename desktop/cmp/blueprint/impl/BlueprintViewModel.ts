import {HoistModel, XH, type ElementFactory} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {last} from 'lodash';
import type {ReactNode} from 'react';
import {
    type AddPlace,
    type BlueprintDesignModel,
    BlueprintWidgetModel,
    type BlueprintModel,
    type WidgetSpec
} from '../../../../blueprint';
import {parentOf} from '../../../../blueprint/impl/elements';
import {boxWidget, BoxWidgetModel} from '../BoxWidget';
import {buttonGroupInputWidget, ButtonGroupInputWidgetModel} from '../ButtonGroupInputWidget';
import {presetSelectorWidget, PresetSelectorWidgetModel} from '../PresetSelectorWidget';
import {buttonGroupWidget, ButtonGroupWidgetModel} from '../ButtonGroupWidget';
import {calloutWidget, CalloutWidgetModel} from '../CalloutWidget';
import {chartWidget, ChartWidgetModel} from '../ChartWidget';
import {cubeGridWidget, CubeGridWidgetModel} from '../CubeGridWidget';
import {dashCanvasWidget, DashCanvasWidgetModel} from '../DashCanvasWidget';
import {dashContainerWidget, DashContainerWidgetModel} from '../DashContainerWidget';
import {gaugeWidget, GaugeWidgetModel} from '../GaugeWidget';
import {heatmapWidget, HeatmapWidgetModel} from '../HeatmapWidget';
import {groupingChooserWidget, GroupingChooserWidgetModel} from '../GroupingChooserWidget';
import {markdownWidget, MarkdownWidgetModel} from '../MarkdownWidget';
import {panelWidget, PanelWidgetModel} from '../PanelWidget';
import {propertyTableWidget, PropertyTableWidgetModel} from '../PropertyTableWidget';
import {separatorWidget, SeparatorWidgetModel} from '../SeparatorWidget';
import {spacerWidget, SpacerWidgetModel} from '../SpacerWidget';
import {statCardWidget, StatCardWidgetModel} from '../StatCardWidget';
import {tabContainerWidget, TabContainerWidgetModel} from '../TabContainerWidget';
import {tileFrameWidget, TileFrameWidgetModel} from '../TileFrameWidget';
import {toolbarWidget, ToolbarWidgetModel} from '../ToolbarWidget';
import {treemapWidget, TreemapWidgetModel} from '../TreemapWidget';
import {
    dateInputWidget,
    DateInputWidgetModel,
    dateRangePickerWidget,
    DateRangePickerWidgetModel,
    filterChooserWidget,
    FilterChooserWidgetModel,
    numberInputWidget,
    NumberInputWidgetModel,
    selectWidget,
    SelectWidgetModel,
    sliderWidget,
    SliderWidgetModel,
    switchInputWidget,
    SwitchInputWidgetModel,
    textInputWidget,
    TextInputWidgetModel
} from '../InputWidgets';
import {elementHost} from './ElementHost';

/** The desktop model and component of each built-in widget, for specs that name neither. */
const DESKTOP_WIDGETS: Record<string, Pick<WidgetSpec, 'model' | 'component'>> = {
    box: {model: BoxWidgetModel, component: boxWidget},
    buttonGroup: {model: ButtonGroupWidgetModel, component: buttonGroupWidget},
    buttonGroupInput: {model: ButtonGroupInputWidgetModel, component: buttonGroupInputWidget},
    presetSelector: {model: PresetSelectorWidgetModel, component: presetSelectorWidget},
    callout: {model: CalloutWidgetModel, component: calloutWidget},
    chart: {model: ChartWidgetModel, component: chartWidget},
    cubeGrid: {model: CubeGridWidgetModel, component: cubeGridWidget},
    dashCanvas: {model: DashCanvasWidgetModel, component: dashCanvasWidget},
    dashContainer: {model: DashContainerWidgetModel, component: dashContainerWidget},
    groupingChooser: {model: GroupingChooserWidgetModel, component: groupingChooserWidget},
    gauge: {model: GaugeWidgetModel, component: gaugeWidget},
    heatmap: {model: HeatmapWidgetModel, component: heatmapWidget},
    markdown: {model: MarkdownWidgetModel, component: markdownWidget},
    panel: {model: PanelWidgetModel, component: panelWidget},
    propertyTable: {model: PropertyTableWidgetModel, component: propertyTableWidget},
    separator: {model: SeparatorWidgetModel, component: separatorWidget},
    spacer: {model: SpacerWidgetModel, component: spacerWidget},
    statCard: {model: StatCardWidgetModel, component: statCardWidget},
    tabContainer: {model: TabContainerWidgetModel, component: tabContainerWidget},
    tileFrame: {model: TileFrameWidgetModel, component: tileFrameWidget},
    toolbar: {model: ToolbarWidgetModel, component: toolbarWidget},
    treemap: {model: TreemapWidgetModel, component: treemapWidget},
    select: {model: SelectWidgetModel, component: selectWidget},
    dateInput: {model: DateInputWidgetModel, component: dateInputWidget},
    dateRangePicker: {model: DateRangePickerWidgetModel, component: dateRangePickerWidget},
    numberInput: {model: NumberInputWidgetModel, component: numberInputWidget},
    textInput: {model: TextInputWidgetModel, component: textInputWidget},
    switchInput: {model: SwitchInputWidgetModel, component: switchInputWidget},
    slider: {model: SliderWidgetModel, component: sliderWidget},
    filterChooser: {model: FilterChooserWidgetModel, component: filterChooserWidget}
};

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

/**
 * Holds one widget model per element, for the element's life, so a widget keeps its model while
 * its config changes. Creates and destroys models as elements come and go, outside of rendering,
 * so a render only looks them up.
 */
export class BlueprintViewModel extends HoistModel {
    readonly blueprintModel: BlueprintModel;
    /** How the host frames a panel in an answer. Null for a Hoist panel. */
    readonly framePanel: BlueprintPanelFrame;
    /** The host's Add, for an empty container's button in design mode. */
    readonly onAddWidget: (place: AddPlace) => void;
    /** The host's Architect, for an empty dashboard's button in design mode. */
    readonly onAskArchitect: () => void;
    /** The designer's selection and changes, for an element to show and take in design mode. */
    readonly designModel: BlueprintDesignModel;
    private readonly widgets = new Map<string, {component: string; model: BlueprintWidgetModel}>();

    /** The elements the Architect's latest edit touched, haloed for a few seconds after it lands. */
    @observableRef accessor haloIds: string[] = [];

    constructor(
        blueprintModel: BlueprintModel,
        opts: {
            framePanel?: BlueprintPanelFrame;
            designModel?: BlueprintDesignModel;
            onAddWidget?: (place: AddPlace) => void;
            onAskArchitect?: () => void;
        } = {}
    ) {
        super();
        this.blueprintModel = blueprintModel;
        this.designModel = opts.designModel ?? null;
        this.framePanel = opts.framePanel ?? null;
        this.onAddWidget = opts.onAddWidget ?? null;
        this.onAskArchitect = opts.onAskArchitect ?? null;
        // Registered before the widgets are made, so that it runs ahead of their reactions and
        // destroys a widget whose element is gone before the widget reacts to it.
        this.addReaction({
            track: () => this.blueprintModel.blueprint?.elements,
            run: () => this.syncWidgets()
        });
        // Synced now, not by fireImmediately, which MobX defers inside a batch such as a render.
        this.syncWidgets();

        const {designModel} = this;
        if (designModel) {
            blueprintModel.revealIssue = issue => designModel.revealIssue(issue);
            this.addReaction(
                {
                    // Also on mounting, so a canvas shown after another view, such as the Map,
                    // shows the selection.
                    track: () => designModel.selectedElementId,
                    run: id => this.bringIntoView(id),
                    fireImmediately: true
                },
                {
                    // Each tab container's tab, for Structure to dim the elements not showing.
                    track: () => {
                        blueprintModel.blueprint?.elements;
                        return [...this.widgets.entries()]
                            .filter(([, it]) => it.model instanceof TabContainerWidgetModel)
                            .map(([id, it]) => [
                                id,
                                (it.model as TabContainerWidgetModel).tabContainerModel.activeTabId
                            ]);
                    },
                    run: tabs => tabs.forEach(([id, tab]) => designModel.setActiveTab(id, tab)),
                    equals: 'structural',
                    fireImmediately: true
                },
                {
                    // Each dash container's views behind another in their stack, likewise.
                    track: () => {
                        blueprintModel.blueprint?.elements;
                        return [...this.widgets.entries()]
                            .filter(([, it]) => it.model instanceof DashContainerWidgetModel)
                            .map(([id, it]): [string, string[]] => [
                                id,
                                (it.model as DashContainerWidgetModel).containerModel.viewModels
                                    .filter(vm => !vm.isActive)
                                    .map(vm => vm.viewSpec.id)
                            ]);
                    },
                    run: views => views.forEach(([id, ids]) => designModel.setHiddenViews(id, ids)),
                    equals: 'structural',
                    fireImmediately: true
                },
                {
                    track: () => last(blueprintModel.history),
                    run: entry => {
                        if (entry?.author !== 'architect') return;
                        const ids = designModel.lastArchitectTouched;
                        this.setHalo(ids);
                        wait(HALO_MS).then(() => {
                            if (this.haloIds === ids) this.setHalo([]);
                        });
                    }
                }
            );
        }
    }

    @action
    setHalo(ids: string[]) {
        this.haloIds = ids;
    }

    /** Activate each tab that holds an element, then scroll it into view. */
    bringIntoView(id: string) {
        const elements = this.blueprintModel.blueprint?.elements ?? {};
        if (!id || !elements[id]) return;
        for (let child = id, parent = parentOf(elements, id); parent;) {
            const model = this.getWidgetModel(parent);
            if (model instanceof TabContainerWidgetModel)
                model.tabContainerModel.activateTab(child);
            if (model instanceof DashContainerWidgetModel) model.activateView(child);
            child = parent;
            parent = parentOf(elements, parent);
        }
        // Once the tab has drawn it.
        wait().then(() =>
            document
                .querySelector(`[data-blueprint-element="${CSS.escape(id)}"]`)
                ?.scrollIntoView?.({block: 'nearest', inline: 'nearest'})
        );
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

// How long the Architect's halo shows. The CSS fades it over the same time.
const HALO_MS = 4000;
