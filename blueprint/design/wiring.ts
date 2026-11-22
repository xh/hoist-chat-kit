import type {Blueprint, ElementWriter} from '../Blueprint';
import {templateRefs} from '../impl/template';
import type {BlueprintSelection} from './BlueprintDesignModel';

// Plain data and pure functions only, so the harness under plain Node can load these.

/** One end of a wire: a part of the blueprint, or what sets a variable from outside it. */
export interface WiringRef {
    kind: 'element' | 'source' | 'variable' | 'preset' | 'prompt' | 'resolver';
    id: string;
    /** Where the reader reads it, or the path a preset group controls, relative to its owner. */
    path?: string;
    /** A name for the wire where its id alone is not enough, such as `prices.end`. */
    label?: string;
}

/** What a selection reads and sets, and what reads and sets it. Every list may be empty. */
export interface BlueprintWiring {
    /** An element's source and variables, a source's parameters, a variable's resolver inputs. */
    reads: WiringRef[];
    /** The variables an element's value, outputs or actions write. */
    sets: WiringRef[];
    /** What reads a source or a variable. A preset group's selectors, which show it. */
    readBy: WiringRef[];
    /** A variable's writers: a prompt, a resolver, elements. */
    setBy: WiringRef[];
    /** The groups that control an element's or a variable's paths, or the paths a group controls. */
    presets: WiringRef[];
    /** A source's parameters bound to a widget's output with no default, which it waits on. */
    waitsFor: WiringRef[];
}

/** A wire between two parts of a blueprint, pointing the way values flow. */
export interface WiringEdge {
    from: BlueprintSelection;
    to: BlueprintSelection;
    /** `sets` runs from a writer to its variable, `preset` from a group to what it controls. */
    kind: 'reads' | 'sets' | 'preset' | 'shows';
    path?: string;
    label?: string;
}

export interface WiringGraph {
    nodes: BlueprintSelection[];
    edges: WiringEdge[];
}

/** Every element, source, variable and preset group of a blueprint, and the wires between them. */
export function wiringGraph(blueprint: Blueprint): WiringGraph {
    const {elements = {}, sources = {}, variables = {}, presets = {}} = blueprint ?? {},
        edges: WiringEdge[] = [],
        seen = new Set<string>(),
        add = (edge: WiringEdge) => {
            const key = `${wiringKey(edge.from)}>${wiringKey(edge.to)}>${edge.kind}`;
            if (seen.has(key)) return;
            seen.add(key);
            edges.push(edge);
        },
        // Each variable and source a value reads, by binding or template, wired into `to`.
        readsIn = (value: unknown, to: BlueprintSelection, label: (path: string) => string) =>
            walk(value, '', (kind, name, path) => {
                const known = kind === 'variable' ? variables : sources;
                if (!Object.hasOwn(known, name)) return;
                add({from: {kind, id: name}, to, kind: 'reads', path, label: label(path)});
            });

    Object.entries(variables).forEach(([name, decl]) => {
        const to: BlueprintSelection = {kind: 'variable', id: name};
        readsIn({compute: decl.compute, default: decl.default, asOf: decl.asOf}, to, () => null);
        const options = decl.options as {source?: string};
        if (options?.source && Object.hasOwn(sources, options.source)) {
            add({from: {kind: 'source', id: options.source}, to, kind: 'reads', path: '/options'});
        }
        writersOf(decl.setBy).forEach(w => {
            if (Object.hasOwn(elements, w.element)) {
                add({from: {kind: 'element', id: w.element}, to, kind: 'sets'});
            }
        });
    });

    Object.entries(sources).forEach(([name, decl]) => {
        const to: BlueprintSelection = {kind: 'source', id: name};
        // A parameter named for its variable needs no label beyond the source.
        readsIn(decl, to, path => {
            const [, key, param] = path.split('/');
            if (key !== 'params') return null;
            const bound = (decl.params?.[param] as {$var?: string})?.$var;
            return bound === param ? null : `${name}.${param}`;
        });
        (decl.joins ?? []).forEach(join => {
            if (Object.hasOwn(sources, join.source)) {
                add({from: {kind: 'source', id: join.source}, to, kind: 'reads', path: '/joins'});
            }
        });
    });

    Object.entries(elements).forEach(([id, el]) => {
        const to: BlueprintSelection = {kind: 'element', id},
            source = el.config?.source;
        if (typeof source === 'string' && Object.hasOwn(sources, source)) {
            add({from: {kind: 'source', id: source}, to, kind: 'reads', path: '/config/source'});
        }
        readsIn(el.config, to, () => null);
        actionTargets(el.config).forEach(name => {
            if (Object.hasOwn(variables, name)) {
                add({from: to, to: {kind: 'variable', id: name}, kind: 'sets'});
            }
        });
        if (el.component === 'presetSelector' && Object.hasOwn(presets, el.config?.group)) {
            add({from: {kind: 'preset', id: el.config.group}, to, kind: 'shows'});
        }
    });

    Object.entries(presets).forEach(([group, decl]) => {
        (decl.controls ?? []).forEach(({path}) => {
            const [, coll, id, ...rest] = path.split('/'),
                kind = coll === 'elements' ? 'element' : coll === 'variables' ? 'variable' : null,
                owner = kind === 'element' ? elements : variables;
            if (!kind || !Object.hasOwn(owner, id)) return;
            add({
                from: {kind: 'preset', id: group},
                to: {kind, id},
                kind: 'preset',
                path: `/${rest.join('/')}`
            });
        });
    });

    return {
        nodes: [
            ...Object.keys(elements).map(id => ({kind: 'element' as const, id})),
            ...Object.keys(sources).map(id => ({kind: 'source' as const, id})),
            ...Object.keys(variables).map(id => ({kind: 'variable' as const, id})),
            ...Object.keys(presets).map(id => ({kind: 'preset' as const, id}))
        ],
        edges
    };
}

/** The wiring of one selection, as its Inspector card lists it. */
export function wiringFor(
    blueprint: Blueprint,
    selection: BlueprintSelection,
    graph: WiringGraph = wiringGraph(blueprint)
): BlueprintWiring {
    const ret: BlueprintWiring = {
        reads: [],
        sets: [],
        readBy: [],
        setBy: [],
        presets: [],
        waitsFor: []
    };
    if (!selection) return ret;
    const key = wiringKey(selection),
        into = graph.edges.filter(it => wiringKey(it.to) === key),
        out = graph.edges.filter(it => wiringKey(it.from) === key),
        refOf = (node: BlueprintSelection, edge: WiringEdge): WiringRef => ({
            kind: node.kind,
            id: node.id,
            ...(edge.label ? {label: edge.label} : {})
        });

    ret.reads = into.filter(it => it.kind === 'reads').map(it => refOf(it.from, it));
    ret.sets = out.filter(it => it.kind === 'sets').map(it => refOf(it.to, it));
    ret.readBy = out
        .filter(it => it.kind === 'reads' || it.kind === 'shows')
        .map(it => refOf(it.to, it));
    ret.presets =
        selection.kind === 'preset'
            ? out
                  .filter(it => it.kind === 'preset')
                  .map(it => ({kind: it.to.kind, id: it.to.id, path: it.path}))
            : into.filter(it => it.kind === 'preset').map(it => refOf(it.from, it));

    if (selection.kind === 'variable') {
        const decl = blueprint.variables[selection.id];
        if (decl.setBy === 'prompt') ret.setBy.push({kind: 'prompt', id: selection.id});
        if (decl.setBy === 'resolver' && decl.compute) {
            ret.setBy.push({kind: 'resolver', id: decl.compute.resolver});
        }
        ret.setBy.push(...into.filter(it => it.kind === 'sets').map(it => refOf(it.from, it)));
    }
    if (selection.kind === 'source') {
        const {variables = {}} = blueprint;
        ret.waitsFor = ret.reads.filter(it => {
            const decl = it.kind === 'variable' ? variables[it.id] : null;
            return decl && !decl.default && writersOf(decl.setBy).some(w => w.output);
        });
    }
    return ret;
}

/**
 * What feeds a node and what it feeds, through the whole graph. Upstream follows what each node
 * reads and the presets that control it, not who writes its variables. Downstream follows every
 * wire.
 */
export function traceWiring(
    graph: WiringGraph,
    from: BlueprintSelection
): {upstream: BlueprintSelection[]; downstream: BlueprintSelection[]} {
    const follow = (step: (key: string) => BlueprintSelection[]) => {
        const found = new Map<string, BlueprintSelection>(),
            queue = [wiringKey(from)];
        while (queue.length) {
            step(queue.shift()).forEach(it => {
                const key = wiringKey(it);
                if (found.has(key) || key === wiringKey(from)) return;
                found.set(key, it);
                queue.push(key);
            });
        }
        return [...found.values()];
    };
    return {
        upstream: follow(key =>
            graph.edges
                .filter(it => it.kind !== 'sets' && wiringKey(it.to) === key)
                .map(it => it.from)
        ),
        downstream: follow(key =>
            graph.edges.filter(it => wiringKey(it.from) === key).map(it => it.to)
        )
    };
}

/** A node's key in a graph, such as `element:posGrid`. */
export function wiringKey(node: BlueprintSelection): string {
    return `${node.kind}:${node.id}`;
}

//------------------
// Implementation
//------------------
function writersOf(setBy: unknown): ElementWriter[] {
    return (Array.isArray(setBy) ? setBy : [setBy]).filter(
        it => it && typeof it === 'object' && typeof it.element === 'string'
    );
}

// The variables an element's actions set or reset, at any depth of its config.
function actionTargets(value: unknown, ret: string[] = []): string[] {
    if (Array.isArray(value)) {
        value.forEach(it => actionTargets(it, ret));
    } else if (value && typeof value === 'object') {
        const it = value as {type?: string; variable?: string};
        if ((it.type === 'setVariable' || it.type === 'resetVariable') && it.variable) {
            ret.push(it.variable);
        }
        Object.values(value).forEach(v => actionTargets(v, ret));
    }
    return ret;
}

// Each variable binding, and each variable or source a template names, with where it sits.
function walk(
    value: unknown,
    path: string,
    visit: (kind: 'variable' | 'source', name: string, path: string) => void
) {
    if (typeof value === 'string') {
        templateRefs(value).forEach(({source, name}) =>
            source ? visit('source', source, path) : visit('variable', name, path)
        );
    } else if (Array.isArray(value)) {
        value.forEach((it, idx) => walk(it, `${path}/${idx}`, visit));
    } else if (value && typeof value === 'object') {
        const binding = (value as {$var?: unknown}).$var;
        if (typeof binding === 'string') {
            visit('variable', binding, path);
            return;
        }
        Object.entries(value).forEach(([k, v]) => walk(v, `${path}/${k}`, visit));
    }
}
