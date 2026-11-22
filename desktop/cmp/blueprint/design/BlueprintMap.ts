import {box, div, hbox, span, vbox} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    type PlainObject,
    useLocalModel
} from '@xh/hoist/core';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import {useOnResize} from '@xh/hoist/utils/react';
import classNames from 'classnames';
import {isEqual, startCase} from 'lodash';
import {createElement, useLayoutEffect, useRef} from 'react';
import {
    type BlueprintDesignModel,
    type BlueprintSelection,
    traceWiring,
    wiringGraph,
    type WiringEdge,
    wiringKey
} from '../../../../blueprint';
import {parentOf} from '../../../../blueprint/impl/elements';
import './BlueprintMap.scss';
import {designHotkeys} from './impl/designHotkeys';

export interface BlueprintMapProps extends HoistProps {
    designModel: BlueprintDesignModel;
    /** Show an element on the canvas, from a double-click on it. It is selected first. */
    onOpenElement?: (id: string) => void;
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
    render({designModel, onOpenElement, className}) {
        const impl = useLocalModel(() => new BlueprintMapModel(designModel)),
            contentRef = useRef<HTMLDivElement>(null),
            measure = () => impl.measure(contentRef.current),
            resizeRef = useOnResize(measure);
        useLayoutEffect(measure);
        return panel({
            className,
            hotkeys: designHotkeys(designModel, {arrows: false}),
            contentBoxProps: {tabIndex: 0, overflow: 'auto'} as object,
            children: box({
                ref: resizeRef,
                className: `${CLS}__scroll`,
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
                                    children: [
                                        div({
                                            className: `${CLS}__lane-title`,
                                            children: lane.title
                                        }),
                                        ...lane.groups.map(group =>
                                            vbox({
                                                key: group.title,
                                                className: `${CLS}__group`,
                                                children: [
                                                    group.title
                                                        ? div({
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
            })
        });
    }
});

/** A node of the map: one part of the blueprint. */
export interface MapNode {
    key: string;
    kind: BlueprintSelection['kind'];
    id: string;
    /** A second line, such as a source's dataset or a tile frame's tile count. */
    detail?: string;
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
}

export type MapNodeState = 'focus' | 'upstream' | 'downstream' | 'preset' | 'dim';

/** @internal */
export class BlueprintMapModel extends HoistModel {
    /** The node under the pointer, whose trace shows over the selection's. */
    @observable accessor hoverKey: string = null;

    /** Each node's box within the map's content, by key, as last drawn. */
    @observableRef accessor boxes: Record<string, Box> = {};

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
    }

    @action
    setHoverKey(key: string) {
        this.hoverKey = key;
    }

    @computed
    get lanes(): MapLane[] {
        const {blueprint} = this.designModel.blueprintModel,
            {variables = {}, sources = {}, presets = {}} = blueprint ?? {},
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
            (variableGroups[group] ??= []).push({key: `variable:${id}`, kind: 'variable', id});
        });
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
                groups: groupOf(
                    Object.entries(sources).map(([id, decl]) => ({
                        key: `source:${id}`,
                        kind: 'source' as const,
                        id,
                        detail: [decl.dataset, ...Object.keys(decl.params ?? {})]
                            .filter(Boolean)
                            .join(' · ')
                    }))
                )
            },
            {
                title: 'Presets',
                groups: groupOf(
                    Object.entries(presets).map(([id, decl]) => ({
                        key: `preset:${id}`,
                        kind: 'preset' as const,
                        id,
                        detail: decl.label
                    }))
                )
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
        wiringGraph(this.designModel.blueprintModel.blueprint).edges.forEach(it => {
            const from = nodeOf(it.from),
                to = nodeOf(it.to),
                key = `${from}>${to}>${it.kind}`;
            if (from === to || seen.has(key)) return;
            seen.add(key);
            ret.push({from, to, kind: it.kind});
        });
        return ret;
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
        const graph = {
                nodes: [],
                edges: this.edges.map(it => ({...it, from: sel(it.from), to: sel(it.to)}))
            },
            {upstream, downstream} = traceWiring(graph, sel(focusKey));
        return {
            upstream: new Set(upstream.map(wiringKey)),
            downstream: new Set(downstream.map(wiringKey))
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
        content.querySelectorAll<HTMLElement>('[data-map-node]').forEach(el => {
            const r = el.getBoundingClientRect();
            boxes[el.dataset.mapNode] = {
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
                parent = parentOf(elements, node.id);
            if (elements[parent]?.component === 'tileFrame') return `element:${parent}`;
        }
        return wiringKey(node);
    };

    // The elements that draw as nodes, under the tab that holds each: every element but a
    // container, and a tile frame in place of its tiles.
    @computed
    private get elementGroups(): MapLane['groups'] {
        const {blueprintModel} = this.designModel,
            {elements = {}} = blueprintModel.blueprint ?? {},
            {registry} = blueprintModel,
            groups = new Map<string, MapNode[]>();
        Object.entries(elements).forEach(([id, el]) => {
            const parent = parentOf(elements, id),
                isContainer = !!registry.widgets[el.component]?.children;
            if (elements[parent]?.component === 'tileFrame') return;
            if (isContainer && el.component !== 'tileFrame') return;
            const tab = this.tabOf(id),
                node: MapNode = {
                    key: `element:${id}`,
                    kind: 'element',
                    id,
                    detail:
                        el.component === 'tileFrame'
                            ? `${el.children?.length ?? 0} tiles`
                            : (registry.widgets[el.component]?.label ?? el.component)
                };
            if (!groups.has(tab)) groups.set(tab, []);
            groups.get(tab).push(node);
        });
        return [...groups.entries()].map(([title, nodes]) => ({title, nodes}));
    }

    // The title of the tab that holds an element, or empty outside any tab.
    private tabOf(id: string): string {
        const {elements = {}} = this.designModel.blueprintModel.blueprint ?? {};
        for (let it = id, parent = parentOf(elements, id); parent;) {
            const container = elements[parent];
            if (TABBED.includes(container.component)) {
                const ref = container.children?.find(c => c.id === it) as PlainObject;
                return (ref?.title as string) ?? startCase(it);
            }
            it = parent;
            parent = parentOf(elements, parent);
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
const TABBED = ['tabContainer', 'dashContainer'];

const groupOf = (nodes: MapNode[]) => (nodes.length ? [{title: '', nodes}] : []);

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
            issues = blueprintModel.issues.filter(it =>
                it.path?.startsWith(`/${COLLECTIONS[node.kind]}/${node.id}`)
            ),
            hasError = issues.some(it => it.severity === 'error');
        return div({
            className: classNames(
                `${CLS}__node`,
                `${CLS}__node--${node.kind}`,
                state && `${CLS}__node--${state}`,
                selection && wiringKey(selection) === node.key && `${CLS}__node--selected`
            ),
            ...({'data-map-node': node.key} as object),
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
                span({className: `${CLS}__node-id`, children: node.id}),
                node.detail
                    ? span({className: `${CLS}__node-detail`, children: node.detail})
                    : null,
                issues.length
                    ? span({
                          className: classNames(
                              `${CLS}__issue`,
                              hasError && `${CLS}__issue--error`
                          ),
                          title: issues.map(it => it.message).join('\n')
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

// One SVG over the lanes, a curve per wire from the boxes last measured.
const edgeLayer = hoistCmp.factory<HoistProps & {impl: BlueprintMapModel}>({
    displayName: 'BlueprintMapEdges',
    model: false,
    render({impl}) {
        const {boxes} = impl;
        return createElement(
            'svg',
            {className: `${CLS}__edges`},
            impl.edges.map(edge => {
                const a = boxes[edge.from],
                    b = boxes[edge.to];
                if (!a || !b) return null;
                // Leave from the side facing the target, and arrive at the side facing back.
                const forward = b.x >= a.x + a.w,
                    x1 = forward ? a.x + a.w : a.x,
                    x2 = forward ? b.x : b.x + b.w,
                    y1 = a.y + a.h / 2,
                    y2 = b.y + b.h / 2,
                    bend = Math.max(40, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1),
                    state = impl.edgeState(edge);
                return createElement('path', {
                    key: `${edge.from}>${edge.to}>${edge.kind}`,
                    d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
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
