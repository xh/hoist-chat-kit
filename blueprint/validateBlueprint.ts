import type {PlainObject} from '@xh/hoist/core';
import {castArray, isArray, isPlainObject, isString} from 'lodash';
import {type Blueprint, type BlueprintIssue, isFieldInstance} from './Blueprint';
import type {BlueprintRegistry} from './BlueprintRegistry';
import type {DataCatalog, FieldDef} from './DataCatalog';
import {checkConfig, checkFilter} from './impl/configSchema';
import {decodePointer, getOwn, isForbiddenKey, toLookup} from './impl/pointer';
import {matchesType} from './impl/variableValues';

export interface ValidateBlueprintContext {
    catalog: Pick<DataCatalog, 'getDataset'>;
    /** A `BlueprintRegistry`, or plain data of the same shape. */
    registry: Pick<BlueprintRegistry, 'widgets' | 'variableTypes' | 'resolvers' | 'actions'>;
    /** The dataset behind each artifact a chat answer can name, keyed by artifact ID. */
    artifacts?: Record<string, string>;
    /** True for a chat answer, which may hold literal parameters, artifacts and inline sources. */
    isAnswer?: boolean;
    /** True for an answer the kit degraded, which may hold its reserved widgets. */
    allowReserved?: boolean;
    /**
     * Elements still streaming. Each one whose widget `rendersPartial` is checked as a value still
     * growing. Only the stream sets this, never what a model writes.
     */
    partialIds?: string[];
}

/** Hoist field types, plus `filter`, which every variable may take. */
export const BUILT_IN_VARIABLE_TYPES = [
    'string',
    'number',
    'int',
    'bool',
    'date',
    'localDate',
    'filter'
];

/**
 * Check a blueprint as a whole: its structure, each element's config against its widget's
 * schema, variables and their writers, sources and their parameters, the fields each widget
 * names, actions and presets.
 *
 * @returns every issue found, errors and warnings. Empty if the blueprint is valid.
 */
export function validateBlueprint(bp: Blueprint, ctx: ValidateBlueprintContext): BlueprintIssue[] {
    const {catalog, registry, isAnswer = false, allowReserved = false} = ctx,
        artifacts = toLookup(ctx.artifacts),
        issues: BlueprintIssue[] = [],
        err = (code: string, path: string, message: string) =>
            issues.push({code, severity: 'error', path, message}),
        warn = (code: string, path: string, message: string) =>
            issues.push({code, severity: 'warning', path, message}),
        typeMatches = (varType: string, want: string) =>
            varType === want || registry.variableTypes[varType]?.matches === want;

    if (!isPlainObject(bp)) {
        err('structure.notObject', '', 'a blueprint is a JSON object');
        return issues;
    }

    // A key that reaches a prototype is refused before anything else reads the blueprint.
    walk(bp, (o, path) => {
        if (!isPlainObject(o)) return;
        Object.keys(o)
            .filter(isForbiddenKey)
            .forEach(k => err('path.forbidden', `${path}/${k}`, `'${k}' is forbidden as a key`));
    });
    if (issues.length) return issues;

    for (const k of Object.keys(bp)) {
        if (!TOP_LEVEL_KEYS.includes(k)) {
            err(
                'structure.unknownKey',
                `/${k}`,
                `unknown top-level key '${k}'. Allowed: ${TOP_LEVEL_KEYS.join(', ')}`
            );
        }
    }

    const elements: Record<string, any> = toLookup(bp.elements),
        variables: Record<string, any> = toLookup(bp.variables),
        sources: Record<string, any> = toLookup(bp.sources);

    // Structure.
    if (!bp.root) {
        err('structure.noRoot', '/root', 'the blueprint has no root element');
    } else if (!elements[bp.root]) {
        err('structure.unknownRoot', '/root', `root '${bp.root}' is not an element`);
    }
    const parent: Record<string, string> = toLookup({});
    for (const [id, el] of Object.entries(elements)) {
        const p = `/elements/${id}`;
        for (const k of Object.keys(el)) {
            if (!ELEMENT_KEYS.includes(k)) {
                err('structure.unknownKey', `${p}/${k}`, `unknown element key '${k}'`);
            }
        }
        const spec = registry.widgets[el.component];
        if (!spec) {
            err(
                'element.unknownComponent',
                `${p}/component`,
                `unknown component '${el.component}'. Use describe_registry to list widgets.`
            );
            continue;
        }
        if (spec.reserved && !allowReserved) {
            err('element.reserved', `${p}/component`, `'${el.component}' is for the kit's own use`);
            continue;
        }
        const isPartial = !!spec.rendersPartial && !!ctx.partialIds?.includes(id);
        for (const e of checkConfig(el.config ?? {}, spec.config, {isPartial})) {
            err('schema.invalid', `${p}/config${e.path}`, e.message);
        }
        if (!isPartial) {
            for (const it of spec.validate?.(el.config ?? {}, {blueprint: bp, id}) ?? []) {
                issues.push({...it, path: `${p}/config${it.path}`});
            }
        }
        if (el.children && !spec.children) {
            err('element.notContainer', `${p}/children`, `${el.component} takes no children`);
        }
        if (el.component === 'dashCanvas') checkCanvasLayout(el, p, err);
        for (const [i, ch] of (el.children ?? []).entries()) {
            if (spec.children) {
                for (const e of checkConfig(ch, spec.children.schema)) {
                    err('schema.invalid', `${p}/children/${i}${e.path}`, e.message);
                }
            }
            if (!elements[ch.id]) {
                err(
                    'structure.unknownChild',
                    `${p}/children/${i}/id`,
                    `child '${ch.id}' is not an element`
                );
            } else if (ch.id === bp.root) {
                err('structure.rootIsChild', `${p}/children/${i}/id`, `'${ch.id}' is the root`);
            } else if (parent[ch.id]) {
                err(
                    'structure.twoParents',
                    `${p}/children/${i}/id`,
                    `'${ch.id}' is already a child of '${parent[ch.id]}'`
                );
            } else {
                parent[ch.id] = id;
            }
        }
    }
    for (const id of Object.keys(elements)) {
        if (id !== bp.root && !parent[id]) {
            err(
                'structure.notPlaced',
                `/elements/${id}`,
                `element '${id}' has no parent, so it never shows`
            );
        }
    }

    // Variables and their writers.
    const settableFromOutside = new Set<string>();
    for (const [vn, v] of Object.entries(variables)) {
        const p = `/variables/${vn}`,
            baseType = String(v.type ?? '').replace(/\[\]$/, '');
        if (!BUILT_IN_VARIABLE_TYPES.includes(baseType) && !registry.variableTypes[baseType]) {
            err('variable.unknownType', `${p}/type`, `unknown type '${v.type}'`);
        }
        const sb = v.setBy,
            writers = getWriters(v);
        if (isString(sb) && !['prompt', 'resolver', 'action'].includes(sb)) {
            err(
                'variable.badSetBy',
                `${p}/setBy`,
                'setBy must be "prompt", "resolver", "action", {"element": id} or {"element": id, "output": name}'
            );
        }
        if (sb === 'resolver' && !v.compute) {
            err('variable.noCompute', p, 'a variable set by a resolver needs compute');
        }
        if (sb !== 'resolver' && v.compute) {
            err(
                'variable.computeWithoutResolver',
                `${p}/compute`,
                'compute needs setBy "resolver"'
            );
        }
        for (const r of [v.compute, v.default].filter(Boolean)) {
            if (r.resolver && !registry.resolvers[r.resolver]) {
                err('variable.unknownResolver', p, `unknown resolver '${r.resolver}'`);
            }
        }
        if (v.default && !('value' in v.default) && !v.default.resolver) {
            err(
                'variable.badDefault',
                `${p}/default`,
                'a default is {"value": ...} or {"resolver": ..., "args": ...}'
            );
        }
        if (isSettableFromOutside(v)) settableFromOutside.add(vn);
        for (const [i, w] of writers.entries()) {
            const wp = writers.length > 1 ? `${p}/setBy/${i}` : `${p}/setBy`,
                el = elements[w.element];
            if (!el) {
                err('variable.unknownWriter', wp, `element '${w.element}' does not exist`);
                continue;
            }
            const spec = registry.widgets[el.component];
            if (!spec) continue;
            if (w.output) {
                const out = (spec.outputs ?? []).find(o => o.name === w.output);
                if (!out) {
                    const names = (spec.outputs ?? []).map(o => o.name).join(', ') || 'none';
                    err(
                        'variable.unknownOutput',
                        wp,
                        `${el.component} has no output '${w.output}'. Outputs: ${names}`
                    );
                } else if (out.type === 'filter' && v.type !== 'filter') {
                    err(
                        'variable.typeMismatch',
                        `${p}/type`,
                        `output '${w.output}' is a filter, but the variable is a ${v.type}`
                    );
                } else if (out.args?.field && !w.field) {
                    err('variable.missingArg', wp, `output '${w.output}' needs a field`);
                }
            } else if (!spec.value) {
                err(
                    'variable.cannotShowValue',
                    wp,
                    `${el.component} cannot show and set a value. Name one of its outputs, or use a different writer.`
                );
            } else if (spec.value.type !== v.type && !typeMatches(v.type, spec.value.type)) {
                err(
                    'variable.typeMismatch',
                    `${p}/type`,
                    `${el.component} sets a ${spec.value.type}, but the variable is a ${v.type}`
                );
            }
        }
        if (writers.length > 1 && v.type !== 'filter') {
            err(
                'variable.writerConflict',
                `${p}/setBy`,
                'only a filter variable can have several writers'
            );
        }
        if (v.default?.personalizable && (sb === 'resolver' || writers.some(w => w.output))) {
            err(
                'variable.notPersonalizable',
                `${p}/default/personalizable`,
                'a variable set by an output or a resolver cannot be personalizable'
            );
        }
    }

    checkResolverCycles(variables, err);

    walk(bp, (o, path) => {
        if (isPlainObject(o) && '$var' in o && !variables[o.$var]) {
            err('variable.unknown', path, `unknown variable '${o.$var}'`);
        }
    });

    // Sources.
    const sourceFields: Record<string, Record<string, FieldDef>> = toLookup({});
    for (const [sn, s] of Object.entries(sources)) {
        const p = `/sources/${sn}`;
        if (s.dataset) {
            const ds = catalog.getDataset(s.dataset);
            if (!ds) {
                err('source.unknownDataset', `${p}/dataset`, `unknown dataset '${s.dataset}'`);
                continue;
            }
            for (const [pn, pv] of Object.entries<any>(s.params ?? {})) {
                const pd = ds.params[pn];
                if (!pd) {
                    err(
                        'source.unknownParam',
                        `${p}/params/${pn}`,
                        `${s.dataset} has no parameter '${pn}'. Parameters: ${Object.keys(ds.params).join(', ')}`
                    );
                } else if (!isAnswer && !(isPlainObject(pv) && '$var' in pv)) {
                    err(
                        'source.literalParam',
                        `${p}/params/${pn}`,
                        `bind parameter '${pn}' to a variable. A blueprint holds no literal parameter values: use a prompted variable, or a variable with no setBy for a constant.`
                    );
                } else if (
                    pv?.$var &&
                    variables[pv.$var] &&
                    !typeMatches(variables[pv.$var].type, pd.type)
                ) {
                    err(
                        'variable.typeMismatch',
                        `${p}/params/${pn}`,
                        `parameter '${pn}' takes a ${pd.type}, but variable '${pv.$var}' is a ${variables[pv.$var].type}`
                    );
                }
            }
            for (const [pn, pd] of Object.entries(ds.params)) {
                if (pd.required && !(pn in (s.params ?? {}))) {
                    err(
                        'source.missingParam',
                        `${p}/params`,
                        `${s.dataset} requires parameter '${pn}'`
                    );
                }
            }
            const fields = toLookup(ds.fields);
            for (const [iname, inst] of Object.entries<any>(s.fields ?? {})) {
                if (!isFieldInstance(inst)) {
                    if (!getOwn(ds.fields, iname)) {
                        err(
                            'source.unknownField',
                            `${p}/fields/${iname}`,
                            `'${iname}' is not a field of ${s.dataset}, so there is nothing to override. An instance names its field in field.`
                        );
                    }
                    checkConfig(inst, FIELD_OVERRIDE_SCHEMA).forEach(it =>
                        err('source.badOverride', `${p}/fields/${iname}${it.path}`, it.message)
                    );
                    continue;
                }
                if (inst?.label != null && !isString(inst.label)) {
                    err('schema.invalid', `${p}/fields/${iname}/label`, 'a label is text');
                }
                const base = ds.fields[inst.field];
                if (!base?.params) {
                    err(
                        'source.badInstance',
                        `${p}/fields/${iname}`,
                        `'${inst.field}' is not a parameterized field of ${s.dataset}`
                    );
                } else {
                    fields[iname] = base;
                }
            }
            sourceFields[sn] = fields;
        } else if (s.artifact) {
            if (!isAnswer) {
                err(
                    'source.artifactOutsideAnswer',
                    p,
                    'only a chat answer can read an artifact. Use a dataset source.'
                );
            }
            const ds = catalog.getDataset(artifacts[s.artifact]);
            if (!ds) {
                err('source.unknownArtifact', `${p}/artifact`, `unknown artifact '${s.artifact}'`);
            } else {
                sourceFields[sn] = ds.fields;
            }
        } else if (s.inline) {
            if (!isAnswer) {
                warn(
                    'source.inlineOutsideAnswer',
                    p,
                    'outside a chat answer, inline rows are for short lists a person writes. Show a value computed from data with a widget over a dataset source.'
                );
                if ((s.inline.rows?.length ?? 0) > MAX_HOST_INLINE_ROWS) {
                    err(
                        'source.tooManyInlineRows',
                        `${p}/inline/rows`,
                        `outside a chat answer, an inline source holds at most ${MAX_HOST_INLINE_ROWS} rows. Use a dataset source.`
                    );
                }
            }
            // A value its field cannot hold would break the source's Cube as it loads.
            const typed = (s.inline.fields ?? []).filter(
                (f: FieldDef) => isString(f?.name) && f.type !== 'string'
            );
            (isArray(s.inline.rows) ? s.inline.rows : []).forEach((row: PlainObject, i: number) =>
                typed.forEach((f: FieldDef) => {
                    const v = row?.[f.name];
                    if (v != null && !matchesType(v, f.type)) {
                        err(
                            'source.badValue',
                            `${p}/inline/rows/${i}/${f.name}`,
                            `${JSON.stringify(v)} is not a ${f.type}`
                        );
                    }
                })
            );
            (s.inline.fields ?? []).forEach((f: FieldDef, i: number) => {
                if (f?.name === 'id') {
                    err(
                        'source.reservedField',
                        `${p}/inline/fields/${i}/name`,
                        "'id' is the key of each row of a source. Name the field otherwise."
                    );
                }
            });
            sourceFields[sn] = toLookup(
                Object.fromEntries((s.inline.fields ?? []).map((f: FieldDef) => [f.name, f]))
            );
        } else {
            err(
                'source.noKind',
                p,
                'a source is {"dataset": ...}, {"artifact": ...} or {"inline": ...}'
            );
        }
    }

    // Field references and actions.
    for (const [id, el] of Object.entries(elements)) {
        const cfg = el.config ?? {},
            p = `/elements/${id}/config`;
        if (cfg.source !== undefined && !sources[cfg.source]) {
            err('source.unknown', `${p}/source`, `unknown source '${cfg.source}'`);
            continue;
        }
        const fields = sourceFields[cfg.source],
            need = (name: string, path: string, role?: 'dimension') => {
                if (!fields || !isString(name)) return;
                const f = fields[name];
                if (!f) {
                    err(
                        'field.unknown',
                        path,
                        `'${name}' is not a field of source '${cfg.source}'`
                    );
                } else if (role === 'dimension' && !f.isDimension) {
                    err('field.notDimension', path, `'${name}' is not a dimension`);
                } else if (f.deprecated) {
                    warn(
                        'field.deprecated',
                        path,
                        `'${name}' is deprecated. Use '${f.replacedBy}'.`
                    );
                }
            };
        if (isArray(cfg.groupBy)) {
            cfg.groupBy.forEach((g: string, i: number) =>
                need(g, `${p}/groupBy/${i}`, 'dimension')
            );
        }
        if (isString(cfg.groupBy)) need(cfg.groupBy, `${p}/groupBy`, 'dimension');
        if (isArray(cfg.columnState)) {
            cfg.columnState.forEach((c: any, i: number) => {
                const f = isString(c) ? c : c?.field;
                if (f !== TREE_COLUMN) need(f, `${p}/columnState/${i}`);
            });
        }
        if (cfg.x) need(cfg.x, `${p}/x`);
        if (isArray(cfg.y)) cfg.y.forEach((y: string, i: number) => need(y, `${p}/y/${i}`));
        if (isArray(cfg.cards)) {
            cfg.cards.forEach((c: any, i: number) => {
                if (c?.deltaField) need(c.deltaField, `${p}/cards/${i}/deltaField`);
                if (c?.field) {
                    need(c.field, `${p}/cards/${i}/field`);
                } else if (fields && c?.agg !== 'count') {
                    err(
                        'schema.invalid',
                        `${p}/cards/${i}`,
                        'a card needs a field, unless its agg is count'
                    );
                }
            });
        }
        castArray(cfg.sortBy ?? []).forEach((sb, i) => {
            const f = isString(sb) ? sb.split('|')[0] : null;
            if (f && f !== TREE_COLUMN)
                need(f, isArray(cfg.sortBy) ? `${p}/sortBy/${i}` : `${p}/sortBy`);
        });
        if (isArray(cfg.dimensions)) {
            cfg.dimensions.forEach((d: string, i: number) =>
                need(d, `${p}/dimensions/${i}`, 'dimension')
            );
        }
        walk(cfg.filter, (o, path) => {
            if (isPlainObject(o) && 'field' in o && 'op' in o)
                need(o.field, `${p}/filter${path}/field`);
        });
        const shown = registry.widgets[el.component]?.demand?.(cfg)?.fields ?? [];
        if (
            cfg.filter &&
            fields &&
            shown.some(f => fields[f]?.aggregator === 'server') &&
            !canFold(cfg.filter, fields, variables, elements, registry)
        ) {
            warn(
                'filter.cannotFold',
                `${p}/filter`,
                'the filter is not single-value equalities on dimensions, so the server fields this widget shows will be blank'
            );
        }
        walk(cfg, (o, path) => {
            if (!isPlainObject(o) || !o.type || !/\/action(\/\d+)?$/.test(path)) return;
            const spec = registry.actions[o.type];
            if (!spec) {
                err(
                    'action.unknown',
                    `${p}${path}/type`,
                    `unknown action '${o.type}'. Actions: ${Object.keys(registry.actions).join(', ')}`
                );
                return;
            }
            if (spec.sideEffects && isAnswer) {
                err(
                    'action.notInAnswer',
                    `${p}${path}/type`,
                    `${o.type} changes data, and a chat answer cannot change data`
                );
            }
            for (const k of Object.keys(o)) {
                if (
                    k !== 'type' &&
                    k !== 'confirm' &&
                    !Object.hasOwn(spec.params.properties ?? {}, k)
                ) {
                    err('action.unknownParam', `${p}${path}/${k}`, `${o.type} takes no '${k}'`);
                }
            }
            if (o.type === 'setVariable' || o.type === 'resetVariable') {
                if (!variables[o.variable]) {
                    err(
                        'variable.unknown',
                        `${p}${path}/variable`,
                        `unknown variable '${o.variable}'`
                    );
                } else if (!settableFromOutside.has(o.variable)) {
                    err(
                        'action.cannotSet',
                        `${p}${path}/variable`,
                        `an action cannot set '${o.variable}'. Give it setBy "action", "prompt" or a widget without an output.`
                    );
                } else if (
                    o.type === 'setVariable' &&
                    variables[o.variable].type === 'filter' &&
                    checkFilter(o.value).length
                ) {
                    err('filter.invalid', `${p}${path}/value`, 'the value is not a filter');
                }
            }
        });
    }

    // Presets: named groups, each controlling its own paths.
    const owner: Record<string, string> = toLookup({});
    for (const [gname, pre] of Object.entries<any>(bp.presets ?? {})) {
        const gp = `/presets/${gname}`;
        if (!isPlainObject(pre) || !isArray(pre.controls)) {
            err(
                'preset.badGroup',
                gp,
                `'${gname}' is not a preset group: {label, controls, default, items}`
            );
            continue;
        }
        for (const k of Object.keys(pre)) {
            if (!PRESET_GROUP_KEYS.includes(k)) {
                err(
                    'structure.unknownKey',
                    `${gp}/${k}`,
                    `unknown preset group key '${k}'. A group has label, controls, default and items.`
                );
            }
        }
        for (const [i, c] of pre.controls.entries()) {
            const path = String(c?.path),
                segs = path.startsWith('/') ? decodePointer(path) : [];
            if (segs[0] !== 'elements' || segs[2] !== 'config' || !elements[segs[1]]) {
                err(
                    'preset.badPath',
                    `${gp}/controls/${i}/path`,
                    `'${path}' must name a config path of an element, such as /elements/grid/config/columnState`
                );
                continue;
            }
            if (owner[path]) {
                err(
                    'preset.twoGroups',
                    `${gp}/controls/${i}/path`,
                    `'${path}' is already controlled by group '${owner[path]}'`
                );
            }
            owner[path] = gname;
            const el = elements[segs[1]],
                presetPaths = registry.widgets[el.component]?.presetPaths ?? [],
                rel = '/' + segs.slice(3).join('/');
            if (!presetPaths.includes(rel)) {
                err(
                    'preset.notPresetPath',
                    `${gp}/controls/${i}/path`,
                    `'${rel}' is not a preset path of ${el.component}. Preset paths: ${presetPaths.join(', ') || 'none'}`
                );
            }
            if (Object.hasOwn(el.config ?? {}, segs[3])) {
                err(
                    'preset.stillInConfig',
                    path,
                    'a path that presets control must leave the element config'
                );
            }
            for (const [iname, item] of Object.entries<any>(pre.items ?? {})) {
                let o = item?.set;
                for (const seg of segs) {
                    o =
                        o != null && typeof o === 'object' && Object.hasOwn(o, seg)
                            ? o[seg]
                            : undefined;
                }
                if (o === undefined) {
                    err(
                        'preset.missingPath',
                        `${gp}/items/${iname}/set`,
                        `preset '${iname}' does not set ${path}`
                    );
                }
            }
        }
        if (pre.default && !getOwn(pre.items, pre.default)) {
            err('preset.unknownDefault', `${gp}/default`, `no preset '${pre.default}'`);
        }
    }
    return issues;
}

/** A variable's writers, as the elements and outputs its `setBy` names. */
export function getWriters(decl: PlainObject): PlainObject[] {
    const sb = decl?.setBy;
    if (isArray(sb)) return sb;
    return isPlainObject(sb) ? [sb] : [];
}

/** True if URL parameters, actions and the Architect may set a variable. */
export function isSettableFromOutside(decl: PlainObject): boolean {
    const sb = decl?.setBy,
        writers = getWriters(decl);
    return sb === 'prompt' || sb === 'action' || (writers.length === 1 && !writers[0].output);
}

//------------------
// Implementation
//------------------
// Names a grid's tree column in `columnState` and `sortBy`.
const MAX_HOST_INLINE_ROWS = 50;
const TREE_COLUMN = 'group';

// How a source shows one of its dataset's fields. Display only.
const FIELD_OVERRIDE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        label: {type: 'string', maxLength: 100},
        description: {type: 'string', maxLength: 500},
        align: {enum: ['left', 'center', 'right']},
        width: {type: 'integer', minimum: 30, maximum: 800},
        format: {'x-format': true},
        renderer: {'x-renderer': true}
    }
};

const TOP_LEVEL_KEYS = ['schema', 'formats', 'variables', 'sources', 'presets', 'root', 'elements'],
    ELEMENT_KEYS = ['component', 'config', 'children', 'personalizable'],
    PRESET_GROUP_KEYS = ['label', 'controls', 'default', 'items'];

/**
 * True if a filter folds into server grouping sets: an AND, at any depth, of single-value `=`
 * clauses on dimensions. A bound filter folds if every writer of its variable is an output that
 * declares it folds, or, for a constant, if its default does.
 */
function canFold(
    filter: unknown,
    fields: Record<string, FieldDef>,
    variables: Record<string, any>,
    elements: Record<string, any>,
    registry: ValidateBlueprintContext['registry']
): boolean {
    if (filter == null) return true;
    if (!isPlainObject(filter)) return false;
    const f = filter as PlainObject,
        recurse = (it: unknown) => canFold(it, fields, variables, elements, registry);

    if (isString(f.$var)) {
        const v = variables[f.$var];
        if (!v) return true;
        if (v.setBy == null) return 'value' in (v.default ?? {}) ? recurse(v.default.value) : false;
        const writers = getWriters(v);
        return (
            !isString(v.setBy) &&
            writers.every(w => {
                const spec = registry.widgets[elements[w.element]?.component];
                return spec?.outputs?.find(o => o.name === w.output)?.folds === true;
            })
        );
    }
    if (isArray(f.filters)) {
        return String(f.op ?? 'AND').toUpperCase() === 'AND' && f.filters.every(recurse);
    }
    if (f.op !== '=' || isArray(f.value) || !fields[f.field]?.isDimension) return false;
    if (isPlainObject(f.value) && isString(f.value.$var)) {
        return !String(variables[f.value.$var]?.type ?? '').endsWith('[]');
    }
    return true;
}

/** Resolver arguments may read other variables, but never in a cycle. Reports each cycle once. */
function checkResolverCycles(
    variables: Record<string, any>,
    err: (code: string, path: string, message: string) => void
) {
    const readsOf = (r: PlainObject): string[] => {
            const ret: string[] = [];
            if (r?.resolver) {
                walk(r.args, o => {
                    if (isPlainObject(o) && isString(o.$var)) ret.push(o.$var);
                });
            }
            return ret;
        },
        state: Record<string, 'visiting' | 'done'> = toLookup({}),
        reported = new Set<string>();

    const visit = (name: string, stack: string[]) => {
        if (!variables[name] || state[name] === 'done') return;
        if (state[name] === 'visiting') {
            const cycle = [...stack.slice(stack.indexOf(name)), name],
                key = [...new Set(cycle)].sort().join();
            if (reported.has(key)) return;
            reported.add(key);
            const [first, next] = cycle,
                {compute} = variables[first];
            err(
                'variable.cycle',
                `/variables/${first}/${readsOf(compute).includes(next) ? 'compute' : 'default'}`,
                `resolver arguments read each other in a cycle: ${cycle.join(' -> ')}`
            );
            return;
        }
        state[name] = 'visiting';
        const {compute, default: def} = variables[name];
        [...readsOf(compute), ...readsOf(def)].forEach(it => visit(it, [...stack, name]));
        state[name] = 'done';
    };
    Object.keys(variables).forEach(it => visit(it, []));
}

/** A canvas places children freely, so they must not overlap or pass the last column. */
function checkCanvasLayout(
    el: PlainObject,
    path: string,
    err: (code: string, path: string, message: string) => void
) {
    const cols = el.config?.columns ?? 12,
        kids = (el.children ?? [])
            .map((c, i) => ({c, i}))
            .filter(({c}) => [c.x, c.y, c.w, c.h].every(Number.isInteger));
    kids.forEach(({c, i}, k) => {
        const at = `${path}/children/${i}`;
        if (c.x + c.w > cols) {
            err(
                'layout.outOfBounds',
                at,
                `'${c.id}' reaches column ${c.x + c.w}, past the last of ${cols}`
            );
        }
        kids.slice(k + 1).forEach(({c: d}) => {
            if (c.x < d.x + d.w && d.x < c.x + c.w && c.y < d.y + d.h && d.y < c.y + c.h) {
                err('layout.overlap', at, `'${c.id}' overlaps '${d.id}'`);
            }
        });
    });
}

function walk(o: any, fn: (v: any, path: string) => void, path = '') {
    fn(o, path);
    if (isArray(o)) {
        o.forEach((v, i) => walk(v, fn, `${path}/${i}`));
    } else if (isPlainObject(o)) {
        for (const [k, v] of Object.entries(o)) walk(v, fn, `${path}/${k}`);
    }
}
