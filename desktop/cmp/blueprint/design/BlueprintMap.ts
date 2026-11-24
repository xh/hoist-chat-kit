import {box, div, hbox, span, vbox} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    type PlainObject,
    useLocalModel,
    XH
} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {Icon} from '@xh/hoist/icon';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import {useOnResize} from '@xh/hoist/utils/react';
import classNames from 'classnames';
import {castArray, isEqual, startCase, uniq} from 'lodash';
import type React from 'react';
import {createElement, useLayoutEffect, useRef} from 'react';
import {
    type BlueprintDesignModel,
    type BlueprintSelection,
    traceWiring,
    wiringFor,
    type WiringEdge,
    type WiringGraph,
    wiringKey
} from '../../../../blueprint';
import {parentMap} from '../../../../blueprint/impl/elements';
import {variableText} from '../../../../blueprint/impl/variableText';
import './BlueprintMap.scss';
import {issueSummary} from './impl/designActions';
import {designHotkeys} from './impl/designHotkeys';
import {usePan} from './impl/usePan';

export interface BlueprintMapProps extends HoistProps {
    designModel: BlueprintDesignModel;
    /** Show an element on the dashboard, from a double-click on it. It is selected first. */
    onOpenElement?: (id: string) => void;
    /** False to leave out the legend strip, giving its height to the map. Default true. */
    showLegend?: boolean;
}

/**
 * A read-only map of a blueprint's wiring: lanes of variables, sources, preset groups and
 * elements, with a line for each wire. A click selects, in the design model's shared selection.
 * The selection, or the node under the pointer, traces what feeds it and what it feeds, and dims
 * the rest.
 */
export const [BlueprintMap, blueprintMap] = hoistCmp.withFactory<BlueprintMapProps>({
    displayName: 'BlueprintMap',
    className: 'xh-blueprint-map',
    model: false,
    render({designModel, onOpenElement, showLegend = true, className}) {
        const impl = useLocalModel(() => new BlueprintMapModel(designModel)),
            contentRef = useRef<HTMLDivElement>(null),
            pan = usePan(
                `${CLS}__scroll`,
                (target, scroll) => target !== scroll && !target.closest(`.${CLS}__node`)
            ),
            measure = () => impl.measure(contentRef.current),
            resizeRef = useOnResize(measure);
        useLayoutEffect(measure);
        return panel({
            className,
            hotkeys: designHotkeys(designModel, {arrows: false}),
            contentBoxProps: {tabIndex: 0},
            children: div({
                className: classNames(`${CLS}__frame`, showLegend && `${CLS}__frame--legend`),
                children: [mapScroll(), showLegend ? legend({key: 'legend', impl}) : null]
            })
        });

        function mapScroll() {
            return box({
                key: 'scroll',
                ref: resizeRef,
                className: `${CLS}__scroll`,
                // Box writes an inline overflow, which the stylesheet cannot override.
                overflow: 'auto',
                minHeight: 0,
                minWidth: 0,
                ...pan,
                children: div({
                    ref: contentRef,
                    className: `${CLS}__content`,
                    children: [
                        hbox({
                            key: 'lanes',
                            className: `${CLS}__lanes`,
                            children: impl.lanes.map(lane =>
                                vbox({
                                    key: lane.title,
                                    className: `${CLS}__lane`,
                                    role: 'listbox',
                                    'aria-label': lane.title,
                                    children: [
                                        div({
                                            'aria-hidden': true,
                                            className: `${CLS}__lane-title`,
                                            children: lane.title
                                        }),
                                        ...lane.groups.map(group =>
                                            vbox({
                                                key: group.title,
                                                className: classNames(
                                                    `${CLS}__group`,
                                                    lane.title === 'Elements' &&
                                                        group.title &&
                                                        `${CLS}__group--tab`
                                                ),
                                                // A listbox holds options and groups only.
                                                role: group.title ? 'group' : 'presentation',
                                                'aria-label': group.title || undefined,
                                                children: [
                                                    group.title
                                                        ? div({
                                                              'aria-hidden': true,
                                                              className: `${CLS}__group-title`,
                                                              children: group.title
                                                          })
                                                        : null,
                                                    ...group.nodes.map(node =>
                                                        mapNode({impl, node, onOpenElement})
                                                    )
                                                ]
                                            })
                                        )
                                    ]
                                })
                            )
                        }),
                        edgeLayer({key: 'edges', impl})
                    ]
                })
            });
        }
    }
});

/** A node of the map: one part of the blueprint. */
export interface MapNode {
    key: string;
    kind: BlueprintSelection['kind'];
    id: string;
    /** A summary beside the id, such as a variable's value or a source's dataset. */
    detail?: string;
    /** A line under it, such as a preset group's presets. */
    line?: string;
    /** A source's bound parameters, each a row that a variable's wire lands on. */
    ports?: string[];
}

export interface MapLane {
    title: string;
    groups: {title: string; nodes: MapNode[]}[];
}

/** A wire between two nodes, by key, after a tile frame takes its tiles' wires. */
export interface MapEdge {
    from: string;
    to: string;
    kind: WiringEdge['kind'];
    /** The source parameter the wire lands on. */
    toPort?: string;
}

export type MapNodeState = 'focus' | 'upstream' | 'downstream' | 'preset' | 'dim';

/** @internal */
export class BlueprintMapModel extends HoistModel {
    /** The node under the pointer, whose trace shows over the selection's. */
    @observable accessor hoverKey: string = null;

    /** A prefix for this map's arrowhead ids, unique on the page. */
    readonly markerId = XH.genId();

    /** Each node's box within the map's content, by key, as last drawn. */
    @observableRef accessor boxes: Record<string, Box> = {};

    /** True while the legend shows its header alone, as the user last left it. */
    @observable accessor legendCollapsed = false;

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
        this.markPersist('legendCollapsed', {localStorageKey: 'xhBlueprintMap'});
    }

    @action
    toggleLegend() {
        this.legendCollapsed = !this.legendCollapsed;
    }

    @action
    setHoverKey(key: string) {
        this.hoverKey = key;
    }

    @computed
    get lanes(): MapLane[] {
        const {blueprintModel} = this.designModel,
            {variables = {}, sources = {}, presets = {}} = blueprintModel.blueprint ?? {},
            variableGroups: Record<string, MapNode[]> = {};
        Object.entries(variables).forEach(([id, decl]) => {
            const group =
                decl.setBy === 'prompt'
                    ? 'Prompts'
                    : decl.setBy === 'resolver'
                      ? 'Computed'
                      : decl.setBy === 'action'
                        ? 'Set by actions'
                        : decl.setBy
                          ? 'Set by widgets'
                          : 'Constants';
            (variableGroups[group] ??= []).push({
                key: `variable:${id}`,
                kind: 'variable',
                id,
                detail: this.variableSummary(id)
            });
        });
        const sourceNodes: MapNode[] = Object.entries(sources).map(([id, decl]) => ({
                key: `source:${id}`,
                kind: 'source',
                id,
                detail: decl.dataset ? `dataset ${decl.dataset}` : null,
                ports: this.portsOf(id)
            })),
            presetNodes: MapNode[] = Object.entries(presets).map(([id, decl]) => ({
                key: `preset:${id}`,
                kind: 'preset',
                id,
                detail: decl.label,
                line: Object.values(decl.items ?? {})
                    .map(it => it.label)
                    .filter(Boolean)
                    .join(' · ')
            }));
        return [
            {
                title: 'Variables',
                groups: VARIABLE_GROUPS.filter(it => variableGroups[it]).map(title => ({
                    title,
                    nodes: variableGroups[title]
                }))
            },
            {
                title: 'Sources',
                groups: [
                    ...(sourceNodes.length ? [{title: '', nodes: sourceNodes}] : []),
                    ...(presetNodes.length ? [{title: 'Presets', nodes: presetNodes}] : [])
                ]
            },
            {title: 'Elements', groups: this.elementGroups}
        ].filter(it => it.groups.length);
    }

    /** The wires between nodes, with each tile's wires moved to its tile frame. */
    @computed
    get edges(): MapEdge[] {
        const {nodeOf} = this,
            seen = new Set<string>(),
            ret: MapEdge[] = [];
        this.designModel.wiring.edges.forEach(it => {
            const from = nodeOf(it.from),
                to = nodeOf(it.to),
                toPort = it.to.kind === 'source' ? portOf(it.path) : null,
                key = `${from}>${to}>${it.kind}>${toPort ?? ''}`;
            if (from === to || seen.has(key)) return;
            seen.add(key);
            ret.push({from, to, kind: it.kind, ...(toPort ? {toPort} : {})});
        });
        return ret;
    }

    /** The one node that takes Tab: the selection's, else the first. */
    @computed
    get tabStop(): string {
        const {selection} = this.designModel,
            keys = this.lanes.flatMap(it => it.groups.flatMap(g => g.nodes.map(n => n.key))),
            selected = selection ? this.nodeOf(selection) : null;
        return keys.includes(selected) ? selected : keys[0];
    }

    /** The node a trace starts from: the one under the pointer, else the selection. */
    @computed
    get focusKey(): string {
        const {selection} = this.designModel;
        return this.hoverKey ?? (selection ? this.nodeOf(selection) : null);
    }

    @computed
    get trace(): {upstream: Set<string>; downstream: Set<string>} {
        const {focusKey} = this;
        if (!focusKey) return null;
        const {upstream, downstream} = traceWiring(this.traceGraph, sel(focusKey));
        return {
            upstream: new Set(upstream.map(wiringKey)),
            downstream: new Set(downstream.map(wiringKey))
        };
    }

    // The Map's wires as a graph to trace, built once per blueprint.
    @computed
    private get traceGraph(): WiringGraph {
        return {
            nodes: [],
            edges: this.edges.map(it => ({...it, from: sel(it.from), to: sel(it.to)}))
        };
    }

    /** How a node draws in the current trace, or null with nothing to trace. */
    stateOf(key: string): MapNodeState {
        const {trace, focusKey} = this;
        if (!trace) return null;
        if (key === focusKey) return 'focus';
        if (trace.upstream.has(key)) return key.startsWith('preset:') ? 'preset' : 'upstream';
        if (trace.downstream.has(key)) return 'downstream';
        return 'dim';
    }

    /** How a wire draws in the current trace, or null with nothing to trace. */
    edgeState(edge: MapEdge): MapNodeState {
        const {trace, focusKey} = this;
        if (!trace) return null;
        const up = (key: string) => key === focusKey || trace.upstream.has(key),
            down = (key: string) => key === focusKey || trace.downstream.has(key);
        if (edge.kind !== 'sets' && up(edge.to) && trace.upstream.has(edge.from)) {
            return edge.kind === 'preset' ? 'preset' : 'upstream';
        }
        if (down(edge.from) && trace.downstream.has(edge.to)) return 'downstream';
        return 'dim';
    }

    select(key: string) {
        this.designModel.select(sel(key));
    }

    /** Measure each node's box within the content, keeping the last set if none moved. */
    measure(content: HTMLElement) {
        if (!content) return;
        const origin = content.getBoundingClientRect(),
            boxes: Record<string, Box> = {};
        content.querySelectorAll<HTMLElement>('[data-map-node], [data-map-port]').forEach(el => {
            const r = el.getBoundingClientRect();
            boxes[el.dataset.mapPort ?? el.dataset.mapNode] = {
                x: r.left - origin.left,
                y: r.top - origin.top,
                w: r.width,
                h: r.height
            };
        });
        if (!isEqual(boxes, this.boxes)) this.setBoxes(boxes);
    }

    @action
    private setBoxes(boxes: Record<string, Box>) {
        this.boxes = boxes;
    }

    // The node that draws a part of the blueprint: a tile's tile frame, else its own.
    private nodeOf = (node: BlueprintSelection): string => {
        if (node.kind === 'element') {
            const {elements = {}} = this.designModel.blueprintModel.blueprint ?? {},
                parent = this.parents.get(node.id);
            if (elements[parent]?.component === 'tileFrame') return `element:${parent}`;
        }
        return wiringKey(node);
    };

    // Each element's container, built once per blueprint.
    @computed
    private get parents(): Map<string, string> {
        return parentMap(this.designModel.blueprintModel.blueprint?.elements);
    }

    // The elements that draw as nodes, under the tab that holds each: every element but a
    // container with no wires, and a tile frame in place of its tiles.
    @computed
    private get elementGroups(): MapLane['groups'] {
        const {blueprintModel} = this.designModel,
            {elements = {}} = blueprintModel.blueprint ?? {},
            {registry} = blueprintModel,
            wired = new Set(this.edges.flatMap(it => [it.from, it.to])),
            groups = new Map<string, MapNode[]>();
        Object.entries(elements).forEach(([id, el]) => {
            const parent = this.parents.get(id),
                isContainer = !!registry.widgets[el.component]?.children;
            if (elements[parent]?.component === 'tileFrame') return;
            if (isContainer && el.component !== 'tileFrame' && !wired.has(`element:${id}`)) return;
            const tab = this.tabOf(id),
                node: MapNode = {
                    key: `element:${id}`,
                    kind: 'element',
                    id,
                    detail:
                        el.component === 'tileFrame'
                            ? this.tilesSummary(el.children ?? [])
                            : (registry.widgets[el.component]?.label ?? el.component)
                };
            if (!groups.has(tab)) groups.set(tab, []);
            groups.get(tab).push(node);
        });
        return [...groups.entries()].map(([title, nodes]) => ({title, nodes}));
    }

    // A variable's value for a prompt or a constant, its resolver for a computed one, else its
    // writers.
    private variableSummary(name: string): string {
        const {blueprintModel} = this.designModel,
            decl = blueprintModel.blueprint.variables[name];
        if (decl.setBy === 'resolver' && decl.compute) {
            const args = Object.entries(decl.compute.args ?? {}).map(([k, v]) => {
                const bound = (v as {$var?: string})?.$var;
                return bound ?? `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`;
            });
            return `${decl.compute.resolver}(${args.join(', ')})`;
        }
        if (decl.setBy === 'action') {
            const writers = wiringFor(
                blueprintModel.blueprint,
                {kind: 'variable', id: name},
                this.designModel.wiring
            ).setBy;
            return `← ${writers.map(it => it.id).join(', ')}`;
        }
        if (decl.setBy && decl.setBy !== 'prompt') {
            const writers = castArray(decl.setBy) as {element: string; output?: string}[];
            return `← ${writers.map(it => [it.element, it.output].filter(Boolean).join(' ')).join(', ')}`;
        }
        const v = blueprintModel.getVariable(name);
        return v ? variableText(v.value, decl.type) || null : null;
    }

    // A tile frame's tiles, by their widget when they share one.
    private tilesSummary(refs: {id: string}[]): string {
        const {blueprint, registry} = this.designModel.blueprintModel,
            components = uniq(refs.map(it => blueprint.elements[it.id]?.component)),
            label = components.length === 1 ? registry.widgets[components[0]]?.label : null;
        return `Tiles · ${refs.length} ${label ? `${label.toLowerCase()}${refs.length === 1 ? '' : 's'}` : 'tiles'}`;
    }

    // A source's bound parameters, and its field instances' parameters as `field.param`.
    private portsOf(name: string): string[] {
        const decl = this.designModel.blueprintModel.blueprint.sources[name];
        return [
            ...Object.keys(decl.params ?? {}),
            ...Object.entries(decl.fields ?? {}).flatMap(([field, it]) =>
                Object.keys((it as {params?: object})?.params ?? {}).map(p => `${field}.${p}`)
            )
        ];
    }

    // The title of the tab that holds an element, or empty outside any tab.
    private tabOf(id: string): string {
        const {elements = {}} = this.designModel.blueprintModel.blueprint ?? {};
        for (let it = id, parent = this.parents.get(id); parent;) {
            const container = elements[parent];
            if (TABBED.includes(container.component)) {
                const ref = container.children?.find(c => c.id === it) as PlainObject;
                return `${(ref?.title as string) ?? startCase(it)} tab · ${it}`;
            }
            it = parent;
            parent = this.parents.get(parent);
        }
        return '';
    }
}

//------------------
// Implementation
//------------------
interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

const CLS = 'xh-blueprint-map';
const VARIABLE_GROUPS = ['Prompts', 'Computed', 'Set by widgets', 'Set by actions', 'Constants'];
const TABBED = ['tabContainer', 'panes'];

// The source parameter at a path a wire reads: `/params/asOf`, or `/fields/retYtd/params/end`.
const portOf = (path: string): string => {
    const segs = (path ?? '').split('/');
    if (segs[1] === 'params') return segs[2];
    if (segs[1] === 'fields' && segs[3] === 'params') return `${segs[2]}.${segs[4]}`;
    return null;
};

const sel = (key: string): BlueprintSelection => {
    const at = key.indexOf(':');
    return {kind: key.slice(0, at) as BlueprintSelection['kind'], id: key.slice(at + 1)};
};

const mapNode = hoistCmp.factory<
    HoistProps & {
        impl: BlueprintMapModel;
        node: MapNode;
        onOpenElement: (id: string) => void;
    }
>({
    displayName: 'BlueprintMapNode',
    model: false,
    render({impl, node, onOpenElement}) {
        const {designModel} = impl,
            {selection, blueprintModel} = designModel,
            state = impl.stateOf(node.key),
            base = `/${COLLECTIONS[node.kind]}/${node.id}`,
            issues = blueprintModel.issues.filter(
                it => it.path === base || it.path?.startsWith(`${base}/`)
            ),
            hasError = issues.some(it => it.severity === 'error'),
            waitsFor =
                node.kind === 'source' && blueprintModel.getSource(node.id)?.isWaiting
                    ? wiringFor(
                          blueprintModel.blueprint,
                          {kind: 'source', id: node.id},
                          designModel.wiring
                      ).waitsFor
                    : [];
        const isSelected = !!selection && wiringKey(selection) === node.key;
        return div({
            className: classNames(
                `${CLS}__node`,
                `${CLS}__node--${node.kind}`,
                state && `${CLS}__node--${state}`,
                isSelected && `${CLS}__node--selected`
            ),
            ...{
                'data-map-node': node.key,
                role: 'option',
                'aria-selected': isSelected,
                'aria-label': [
                    node.id,
                    node.detail,
                    STATE_WORDS[state],
                    issues.length ? issueSummary(issues) : null
                ]
                    .filter(Boolean)
                    .join(', ')
            },
            tabIndex: impl.tabStop === node.key ? 0 : -1,
            onFocus: () => impl.setHoverKey(node.key),
            onBlur: () => {
                if (impl.hoverKey === node.key) impl.setHoverKey(null);
            },
            onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => moveFocus(e, impl),
            onClick: () => impl.select(node.key),
            onDoubleClick: () => {
                impl.select(node.key);
                if (node.kind === 'element') onOpenElement?.(node.id);
            },
            onMouseEnter: () => {
                impl.setHoverKey(node.key);
                if (node.kind === 'element') designModel.setHovered(node.id);
            },
            onMouseLeave: () => {
                impl.setHoverKey(null);
                if (designModel.hoveredId === node.id) designModel.setHovered(null);
            },
            children: [
                div({
                    className: `${CLS}__node-head`,
                    children: [
                        span({className: `${CLS}__node-id`, children: node.id}),
                        span({
                            className: `${CLS}__node-detail`,
                            children: waitsFor.length
                                ? `waits for ${waitsFor.map(it => it.id).join(', ')}`
                                : node.detail
                        })
                    ]
                }),
                node.line ? div({className: `${CLS}__node-line`, children: node.line}) : null,
                ...(node.ports ?? []).map(port =>
                    div({
                        key: port,
                        className: `${CLS}__port`,
                        ...{'data-map-port': `${node.key}#${port}`},
                        children: port
                    })
                ),
                issues.length
                    ? span({
                          className: classNames(
                              `${CLS}__issue`,
                              hasError && `${CLS}__issue--error`
                          ),
                          title: issues.map(it => it.message).join('\n'),
                          role: 'img',
                          'aria-label': issueSummary(issues)
                      })
                    : null
            ]
        });
    }
});

const COLLECTIONS = {
    element: 'elements',
    source: 'sources',
    variable: 'variables',
    preset: 'presets'
};

// A node's place in the trace, as a screen reader says it.
const STATE_WORDS: Record<string, string> = {
    focus: 'traced from here',
    upstream: 'feeds the selection',
    downstream: 'fed by the selection',
    preset: 'controls the selection'
};

// The arrows move through a lane's options, and across to the next lane. Enter or Space selects.
function moveFocus(e: React.KeyboardEvent<HTMLElement>, impl: BlueprintMapModel) {
    const lane = e.currentTarget.closest('[role=listbox]'),
        lanes = [...(lane?.parentElement?.querySelectorAll('[role=listbox]') ?? [])],
        options = (it: Element) => [...it.querySelectorAll<HTMLElement>('[role=option]')],
        mine = options(lane),
        at = mine.indexOf(e.currentTarget),
        across = (step: number) => options(lanes[lanes.indexOf(lane) + step] ?? lane)[0],
        target =
            e.key === 'ArrowDown'
                ? mine[at + 1]
                : e.key === 'ArrowUp'
                  ? mine[at - 1]
                  : e.key === 'ArrowRight'
                    ? across(1)
                    : e.key === 'ArrowLeft'
                      ? across(-1)
                      : null;
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        impl.select(e.currentTarget.dataset.mapNode);
    } else if (target) {
        e.preventDefault();
        e.stopPropagation();
        target.focus();
        impl.setHoverKey(target.dataset.mapNode);
    }
}

const EDGE_STATES = ['none', 'upstream', 'downstream', 'preset', 'dim'];

// One SVG over the lanes, a curve per wire from the boxes last measured, with an arrowhead in the
// wire's color.
const edgeLayer = hoistCmp.factory<HoistProps & {impl: BlueprintMapModel}>({
    displayName: 'BlueprintMapEdges',
    model: false,
    render({impl}) {
        const {boxes, markerId} = impl;
        return createElement(
            'svg',
            {className: `${CLS}__edges`, 'aria-hidden': true},
            createElement(
                'defs',
                {key: 'defs'},
                EDGE_STATES.map(state =>
                    createElement(
                        'marker',
                        {
                            key: state,
                            id: `${markerId}-${state}`,
                            className: `${CLS}__arrow ${CLS}__arrow--${state}`,
                            viewBox: '0 0 8 8',
                            refX: 7,
                            refY: 4,
                            markerWidth: 6,
                            markerHeight: 6,
                            orient: 'auto'
                        },
                        createElement('path', {d: 'M 0 0 L 8 4 L 0 8 z'})
                    )
                )
            ),
            ...impl.edges.map(edge => {
                const a = boxes[edge.from],
                    b = (edge.toPort && boxes[`${edge.to}#${edge.toPort}`]) || boxes[edge.to];
                if (!a || !b) return null;
                const state = impl.edgeState(edge),
                    y1 = a.y + a.h / 2,
                    y2 = b.y + b.h / 2;
                let d: string;
                if (Math.abs(a.x - b.x) < 1) {
                    // Two nodes of one lane, such as a resolver's input: an arc off its left edge.
                    const bulge = Math.min(48, 16 + Math.abs(y2 - y1) / 4);
                    d = `M ${a.x} ${y1} C ${a.x - bulge} ${y1}, ${b.x - bulge} ${y2}, ${b.x} ${y2}`;
                } else {
                    // Leave from the side facing the target, and arrive at the side facing back.
                    const forward = b.x >= a.x + a.w,
                        x1 = forward ? a.x + a.w : a.x,
                        x2 = forward ? b.x : b.x + b.w,
                        bend = Math.max(40, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
                    d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
                }
                return createElement('path', {
                    key: `${edge.from}>${edge.to}>${edge.kind}>${edge.toPort ?? ''}`,
                    d,
                    markerEnd: `url(#${markerId}-${state ?? 'none'})`,
                    className: classNames(
                        `${CLS}__edge`,
                        `${CLS}__edge--${edge.kind}`,
                        state && `${CLS}__edge--${state}`
                    )
                });
            })
        );
    }
});

// What the trace's colors mean, in a corner over the map, which folds to its header.
const legend = hoistCmp.factory<HoistProps & {impl: BlueprintMapModel}>({
    displayName: 'BlueprintMapLegend',
    model: false,
    render({impl}) {
        const collapsed = impl.legendCollapsed;
        return div({
            className: classNames(`${CLS}__legend`, collapsed && `${CLS}__legend--collapsed`),
            ...{role: 'group', 'aria-label': 'Legend'},
            children: [
                button({
                    key: 'header',
                    className: `${CLS}__legend-header`,
                    text: 'Legend',
                    rightIcon: collapsed ? Icon.chevronUp() : Icon.chevronDown(),
                    minimal: true,
                    onClick: () => impl.toggleLegend(),
                    ...{'aria-expanded': !collapsed}
                }),
                collapsed
                    ? null
                    : vbox({
                          key: 'items',
                          className: `${CLS}__legend-items`,
                          children: [
                              ['upstream', 'Upstream (reads)'],
                              ['downstream', 'Downstream (sets, then onward)'],
                              ['preset', 'Preset controls a path'],
                              ['dim', 'Other bindings']
                          ].map(([state, text]) =>
                              span({
                                  key: state,
                                  className: `${CLS}__legend-item ${CLS}__legend-item--${state}`,
                                  children: text
                              })
                          )
                      })
            ]
        });
    }
});
