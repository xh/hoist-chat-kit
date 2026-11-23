import {HoistModel, managed, XH, type ElementFactory} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {forEach, isEqual, last} from 'lodash';
import type {ReactNode} from 'react';
import {
    type AddPlace,
    type BlueprintDesignModel,
    BlueprintWidgetModel,
    type BlueprintModel,
    type DropSource,
    type DropTarget,
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
import {dashboardWidget, DashboardWidgetModel} from '../DashboardWidget';
import {panesWidget, PanesWidgetModel} from '../PanesWidget';
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
import {altHold} from '../design/impl/altHold';
import {dropMarks} from '../design/impl/dropMarks';
import {type DropPlace, dropPlaceAt} from '../design/impl/dropTargets';
import {currentDropSource, elementDrag} from '../design/impl/elementDrag';
import {paletteDrag} from './paletteDrag';
import {designMarks, elementMarks} from '../design/impl/designOverlay';
import {boxElement, OverlayModel} from '../../layout/overlay';
import {designEmpty, elementHost} from './ElementHost';

/** The desktop model and component of each built-in widget, for specs that name neither. */
const DESKTOP_WIDGETS: Record<string, Pick<WidgetSpec, 'model' | 'component'>> = {
    box: {model: BoxWidgetModel, component: boxWidget},
    buttonGroup: {model: ButtonGroupWidgetModel, component: buttonGroupWidget},
    buttonGroupInput: {model: ButtonGroupInputWidgetModel, component: buttonGroupInputWidget},
    presetSelector: {model: PresetSelectorWidgetModel, component: presetSelectorWidget},
    callout: {model: CalloutWidgetModel, component: calloutWidget},
    chart: {model: ChartWidgetModel, component: chartWidget},
    cubeGrid: {model: CubeGridWidgetModel, component: cubeGridWidget},
    dashboard: {model: DashboardWidgetModel, component: dashboardWidget},
    panes: {model: PanesWidgetModel, component: panesWidget},
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

    /** The layer over the blueprint where design mode marks hover and selection. */
    @managed readonly overlay = new OverlayModel();

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

        const {designModel, overlay} = this;
        if (designModel) {
            blueprintModel.revealIssue = issue => designModel.revealIssue(issue);
            overlay.addMarks('elements', () =>
                elementMarks(designModel, {
                    haloIds: this.haloIds,
                    empty: id => designEmpty(id, this)
                })
            );
            overlay.addMarks('design', () => designMarks(designModel, overlay));
            this.stopAltHold = altHold.follow();
            this.stopSelectGuard = this.guardTextSelection();
            overlay.addMarks('drop', () => dropMarks(this.dropPreview));
            this.stopDropFollow = this.followDrops();
            this.addReaction(
                {
                    // Elements move once the change has drawn, as after an edit or a tab switch.
                    track: () => [
                        blueprintModel.blueprint,
                        blueprintModel.mode,
                        designModel.activeTabs,
                        designModel.hiddenViews
                    ],
                    run: () => wait().then(() => overlay.layoutChanged())
                },
                {
                    // Also on mounting, so a dashboard shown after another view, such as the Map,
                    // shows the selection.
                    // A selected view shows through its widget, on whatever tab holds it.
                    track: () => designModel.selectedElementId ?? designModel.selectedViewId,
                    run: id => this.bringIntoView(id),
                    fireImmediately: true
                },
                {
                    // What each tab and panes widget shows, for Structure to dim the rest.
                    track: () => {
                        blueprintModel.blueprint?.elements;
                        const activeTabs: Record<string, string> = {},
                            hiddenViews: Record<string, string[]> = {};
                        this.widgets.forEach(({model}, id) => {
                            if (model instanceof TabContainerWidgetModel) {
                                activeTabs[id] = model.tabContainerModel.activeTabId;
                            } else if (model instanceof PanesWidgetModel) {
                                hiddenViews[id] = model.hiddenViews;
                            }
                        });
                        return {activeTabs, hiddenViews};
                    },
                    run: ({activeTabs, hiddenViews}) =>
                        designModel.setCanvasTabs(activeTabs, hiddenViews),
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
            if (model instanceof PanesWidgetModel) model.activateView(child);
            child = parent;
            parent = parentOf(elements, parent);
        }
        // Once the tab has drawn it.
        wait().then(() =>
            boxElement(
                document.querySelector(`[data-blueprint-element="${CSS.escape(id)}"]`)
            )?.scrollIntoView?.({block: 'nearest', inline: 'nearest'})
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

    private stopAltHold: () => void = null;
    private stopSelectGuard: () => void = null;

    // In Edit a press selects, so a stray drag starts no text selection, unless Alt is held. One
    // made under Alt outlives the hold, so it can be copied once Alt is up.
    private guardTextSelection(): () => void {
        const guard = (e: Event) => {
            const {designModel, overlay} = this,
                target = e.target as Node;
            if (designModel?.interaction !== 'edit' || altHold.active) return;
            if (!overlay.hostEl?.contains(target)) return;
            const el = target instanceof Element ? target : target.parentElement;
            if (el?.closest('input, textarea, [contenteditable]')) return;
            e.preventDefault();
        };
        document.addEventListener('selectstart', guard, true);
        return () => document.removeEventListener('selectstart', guard, true);
    }
    private stopDropFollow: () => void = null;

    // Each place's verdict for a source, while the blueprint stays the same, as a drag asks for
    // it on every dragover.
    private verdicts = {blueprint: null as object, source: null as DropSource, byTarget: new Map()};

    private dropPlace(source: DropSource, x: number, y: number): DropPlace {
        const {designModel, overlay, blueprintModel, verdicts} = this,
            host = overlay.hostEl;
        if (!host || !designModel || blueprintModel.mode !== 'design') return null;
        if (verdicts.blueprint !== blueprintModel.blueprint || !isEqual(verdicts.source, source)) {
            Object.assign(verdicts, {blueprint: blueprintModel.blueprint, source});
            verdicts.byTarget.clear();
        }
        return dropPlaceAt(host, blueprintModel, source, x, y, (s, t) => {
            const key = JSON.stringify(t);
            if (!verdicts.byTarget.has(key))
                verdicts.byTarget.set(key, designModel.canDropAt(s, t));
            return verdicts.byTarget.get(key);
        });
    }

    @action
    private setDropPreview(place: DropPlace) {
        if (!samePreview(place, this.dropPreview)) this.dropPreview = place;
    }

    // Follow drags over the page: preview where one would drop on the blueprint, and drop it there.
    // A dashboard or a panes widget takes its own, so only its outline shows here.
    private followDrops(): () => void {
        const host = () => this.overlay.hostEl,
            over = (e: DragEvent) => {
                const source = currentDropSource();
                if (!source || !host()?.contains(e.target as Node))
                    return this.setDropPreview(null);
                const place = this.dropPlace(source, e.clientX, e.clientY);
                this.setDropPreview(place);
                if (!place || place.ownDrop) return;
                if (place.refusal) {
                    e.dataTransfer.dropEffect = 'none';
                } else {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }
            },
            drop = (e: DragEvent) => {
                const source = currentDropSource(),
                    place = source && this.dropPreview;
                this.setDropPreview(null);
                if (!place || place.ownDrop || place.refusal) return;
                e.preventDefault();
                paletteDrag.end();
                elementDrag.end();
                this.designModel.dropAt(source, place.target);
            },
            leave = (e: DragEvent) => {
                const to = e.relatedTarget as Node;
                if (!to || !host()?.contains(to)) this.setDropPreview(null);
            },
            end = () => {
                this.setDropPreview(null);
                elementDrag.end();
            };
        const listeners = {dragover: over, drop, dragleave: leave, dragend: end};
        // Capturing, as a dashboard stops the drags it handles from bubbling, even over a container in
        // one of its cells.
        forEach(listeners, (fn, type) => window.addEventListener(type, fn, true));
        return () => forEach(listeners, (fn, type) => window.removeEventListener(type, fn, true));
    }

    /**
     * Where a drag of an element or a palette widget would drop at a point of the page, without
     * dropping: its container and place there, and why it would be refused. The same place a drag
     * shows and drops at, for a test or a script, such as `XH.getModels('BlueprintViewModel')` from
     * DevTools. Null over no container.
     */
    previewDrop(source: DropSource, x: number, y: number): DropTarget & {refusal: string} {
        const place = this.dropPlace(source, x, y);
        return place ? {...place.target, refusal: place.refusal} : null;
    }

    /** The drop a drag over the blueprint would make, which the overlay shows. */
    @observableRef accessor dropPreview: DropPlace = null;

    override destroy() {
        this.stopDropFollow?.();
        this.stopAltHold?.();
        this.stopSelectGuard?.();
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

// Whether two drop places draw the same, so a dragover that changes neither leaves the preview be.
// The pointer counts only under a refusal, whose reason shows at it.
function samePreview(a: DropPlace, b: DropPlace): boolean {
    if (!a || !b) return a === b;
    return (
        a.containerEl === b.containerEl &&
        a.ownDrop === b.ownDrop &&
        a.refusal === b.refusal &&
        isEqual(a.target, b.target) &&
        isEqual(a.line, b.line) &&
        (!a.refusal || isEqual(a.pointer, b.pointer))
    );
}

function pickDefined(spec: WidgetSpec): Pick<WidgetSpec, 'model' | 'component'> {
    const ret: Pick<WidgetSpec, 'model' | 'component'> = {};
    if (spec?.model) ret.model = spec.model;
    if (spec?.component) ret.component = spec.component;
    return ret;
}

// How long the Architect's halo shows. The CSS fades it over the same time.
const HALO_MS = 4000;
