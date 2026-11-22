import type {PlainObject} from '@xh/hoist/core';
import {
    castArray,
    isArray,
    isEmpty,
    isEqual,
    isNumber,
    isPlainObject,
    isString,
    omit
} from 'lodash';
import {
    type Blueprint,
    type BlueprintIssue,
    isFieldInstance,
    type JoinDecl,
    type VariableDecl
} from './Blueprint';
import {BLUEPRINT_LINK_RESERVED} from './impl/linkParams';
import type {BlueprintRegistry, SlotAccepts, SlotSpec, WidgetSpec} from './BlueprintRegistry';
import type {DataCatalog, FieldDef} from './DataCatalog';
import {checkConfig, checkFilter, templateStrings, toPointer} from './impl/configSchema';
import {isStyleColor, MAX_STYLE_RULES} from './impl/gridStyles';
import {joinFields} from './impl/joins';
import {slotLists} from './impl/elements';
import {decodePointer, getOwn, isForbiddenKey, toLookup} from './impl/pointer';
import {parseTemplate, templateRefs} from './impl/template';
import {
    boundPeriodCalendar,
    checkVariableValue,
    matchesType,
    withInlineType
} from './impl/variableValues';

export interface ValidateBlueprintContext {
    catalog: Pick<DataCatalog, 'getDataset'>;
    /** A `BlueprintRegistry`, or plain data of the same shape. */
    registry: Pick<BlueprintRegistry, 'widgets' | 'variableTypes' | 'resolvers' | 'actions'> &
        Partial<Pick<BlueprintRegistry, 'dateRangePresets'>>;
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
    'filter',
    'dateRange',
    'period'
];

/** A variable type in users' words, such as `Local date`, or `List of text` for `string[]`. */
export function variableTypeLabel(
    registry: Pick<BlueprintRegistry, 'variableTypes'>,
    type: string
): string {
    if (type?.endsWith('[]'))
        return `List of ${variableTypeLabel(registry, type.slice(0, -2)).toLowerCase()}`;
    const app = registry.variableTypes[type];
    if (app) return app.label ?? app.name.split('.').at(-1);
    return TYPE_LABELS[type] ?? type;
}

const TYPE_LABELS: Record<string, string> = {
    string: 'Text',
    number: 'Number',
    int: 'Whole number',
    bool: 'Yes or no',
    date: 'Date and time',
    localDate: 'Local date',
    filter: 'Filter',
    dateRange: 'Date range',
    period: 'Period'
};

/** True if a variable of one type can stand for a value of another: the same, or an app type of it. */
export function variableTypeMatches(
    registry: Pick<BlueprintRegistry, 'variableTypes'>,
    varType: string,
    want: string
): boolean {
    return varType === want || registry.variableTypes[varType]?.matches === want;
}

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
            variableTypeMatches(registry, varType, want),
        // A field instance's params: each one the field takes, a value of its type or a binding,
        // which the walk of bindings checks, with every required one given.
        checkInstanceParams = (p: string, params: PlainObject, defs: PlainObject) => {
            for (const [pn, pv] of Object.entries(params)) {
                const pd = defs[pn];
                if (!pd) {
                    err(
                        'source.unknownParam',
                        `${p}/${pn}`,
                        `the field takes no parameter '${pn}'`
                    );
                } else if (!(isPlainObject(pv) && '$var' in pv) && !matchesType(pv, pd.type)) {
                    err('source.badParam', `${p}/${pn}`, `parameter '${pn}' takes a ${pd.type}`);
                }
            }
            for (const [pn, pd] of Object.entries<PlainObject>(defs)) {
                if (pd.required && !Object.hasOwn(params, pn)) {
                    err('source.missingParam', p, `the field requires parameter '${pn}'`);
                }
            }
        };

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
        sources: Record<string, any> = toLookup(bp.sources),
        // Each element config key a preset group controls, as `id/key`.
        presetKeys = new Set(
            Object.values(toLookup(bp.presets))
                // Only a group with presets gives its paths a value.
                .filter((it: any) => isPlainObject(it?.items) && !isEmpty(it.items))
                .flatMap((it: any) => (Array.isArray(it?.controls) ? it.controls : []))
                .map(it => String(it?.path ?? '').split('/'))
                .filter(segs => segs[1] === 'elements' && segs[3] === 'config' && segs[4])
                .map(segs => `${segs[2]}/${segs[4]}`)
        );

    // Structure.
    if (!bp.root) {
        err('structure.noRoot', '/root', 'the blueprint has no root element');
    } else if (!elements[bp.root]) {
        err('structure.unknownRoot', '/root', `root '${bp.root}' is not an element`);
    }
    const parent: Record<string, string> = toLookup({});
    for (const [id, el] of Object.entries(elements)) {
        const p = `/elements/${id}`,
            spec = registry.widgets[el.component];
        for (const k of Object.keys(el)) {
            if (!ELEMENT_KEYS.includes(k) && !(spec && getOwn(spec.slots, k))) {
                err('structure.unknownKey', `${p}/${k}`, `unknown element key '${k}'`);
            }
        }
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
            // A key that presets control leaves the config, and each preset gives its value.
            if (e.message.endsWith(' is required') && presetKeys.has(`${id}${e.path}`)) continue;
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
        if (el.component === 'dashCanvas') {
            checkCanvasLayout(el, p, err, warn, it => registry.widgets[elements[it]?.component]);
        }
        if (el.component === 'dateRangePicker' && registry.dateRangePresets) {
            castArray(el.config?.presets ?? []).forEach((token: string, i: number) => {
                if (!registry.dateRangePresets[token]) {
                    err(
                        'dateRangePicker.unknownPreset',
                        `${p}/config/presets/${i}`,
                        `there is no date range preset '${token}'`
                    );
                }
            });
        }
        const cellSlots = spec.children?.slots ?? {};
        for (const {slot, of, refs} of slotLists(el)) {
            const ci = of ? el.children.findIndex((it: PlainObject) => it.id === of) : -1,
                at = of ? `${p}/children/${ci}/${slot}` : `${p}/${slot}`,
                slotSpec: SlotSpec = of
                    ? getOwn(cellSlots, slot)
                    : slot === 'children'
                      ? null
                      : getOwn(spec.slots, slot);
            if (of && !slotSpec) continue; // The child reference's schema names the key.
            if (slot === 'children' && !spec.children) continue;
            if (slotSpec?.maxItems != null && refs.length > slotSpec.maxItems) {
                err('slot.full', at, `${slot} holds at most ${slotSpec.maxItems}`);
            }
            for (const [i, ch] of refs.entries()) {
                const schema = slot === 'children' ? spec.children.schema : SLOT_REF_SCHEMA;
                // A cell's own slot lists are checked as slots, not as its placement.
                const placement = slot === 'children' ? omit(ch, Object.keys(cellSlots)) : ch;
                for (const e of checkConfig(placement, schema)) {
                    err('schema.invalid', `${at}/${i}${e.path}`, e.message);
                }
                if (!elements[ch.id]) {
                    err(
                        'structure.unknownChild',
                        `${at}/${i}/id`,
                        `child '${ch.id}' is not an element`
                    );
                } else if (ch.id === bp.root) {
                    err('structure.rootIsChild', `${at}/${i}/id`, `'${ch.id}' is the root`);
                } else if (parent[ch.id]) {
                    err(
                        'structure.twoParents',
                        `${at}/${i}/id`,
                        `'${ch.id}' is already a child of '${parent[ch.id]}'`
                    );
                } else {
                    parent[ch.id] = id;
                    const childSpec = registry.widgets[elements[ch.id].component],
                        rule = slotSpec ? slotSpec.accepts : spec.children.accepts;
                    if (childSpec && !accepts(rule, childSpec)) {
                        err(
                            'element.notAccepted',
                            `${at}/${i}/id`,
                            `${el.component} cannot hold '${ch.id}', a ${childSpec.name}, in ${slot}. It takes ${describeAccepts(rule)}.`
                        );
                    }
                }
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
        if (BLUEPRINT_LINK_RESERVED.includes(vn)) {
            err(
                'variable.reservedName',
                p,
                `'${vn}' is a link param, so a variable may not take it`
            );
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
        for (const [key, r] of Object.entries({compute: v.compute, default: v.default})) {
            if (!r) continue;
            if (r.resolver && !registry.resolvers[r.resolver]) {
                err('variable.unknownResolver', p, `unknown resolver '${r.resolver}'`);
            }
            const declared = boundPeriodCalendar(r.args, variables);
            if (declared && r.args?.calendar != null && r.args.calendar !== declared) {
                warn(
                    'resolver.calendarMismatch',
                    `${p}/${key}/args/calendar`,
                    `the calendar is '${r.args.calendar}', but its period variable counts in '${declared}'`
                );
            }
        }
        if (v.default && !('value' in v.default) && !v.default.resolver) {
            err(
                'variable.badDefault',
                `${p}/default`,
                'a default is {"value": ...} or {"resolver": ..., "args": ...}'
            );
        } else if (
            v.default &&
            'value' in v.default &&
            ['dateRange', 'period'].includes(baseType)
        ) {
            const problem = checkVariableValue(vn, v, v.default.value, registry);
            if (problem) err('variable.badValue', `${p}/default/value`, problem);
        }
        if (v.asOf != null && variables[v.asOf?.$var]?.type !== 'localDate') {
            err('variable.badAsOf', `${p}/asOf`, 'asOf is a binding to a localDate variable');
        }
        if (v.calendar != null && !['business', 'calendar'].includes(v.calendar)) {
            err('variable.badCalendar', `${p}/calendar`, "calendar is 'business' or 'calendar'");
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
            } else if (!castArray(spec.value.type).some(it => typeMatches(v.type, it))) {
                err(
                    'variable.typeMismatch',
                    `${p}/type`,
                    `${el.component} sets a ${castArray(spec.value.type).join(' or ')}, but the variable is a ${v.type}`
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
    // Each source's joined values that show only where a row pins the join's key.
    const keyedFields: Record<string, Set<string>> = toLookup({});
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
                checkConfig(omit(inst, 'field', 'params'), FIELD_OVERRIDE_SCHEMA).forEach(it =>
                    err('source.badOverride', `${p}/fields/${iname}${it.path}`, it.message)
                );
                const base = ds.fields[inst.field];
                if (!base?.params) {
                    err(
                        'source.badInstance',
                        `${p}/fields/${iname}`,
                        `'${inst.field}' is not a parameterized field of ${s.dataset}`
                    );
                } else {
                    fields[iname] = base;
                    checkInstanceParams(
                        `${p}/fields/${iname}/params`,
                        inst.params ?? {},
                        base.params
                    );
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
                Object.fromEntries(
                    (s.inline.fields ?? []).map((f: FieldDef) => [
                        f.name,
                        withInlineType(f, s.inline.rows)
                    ])
                )
            );
        } else {
            err(
                'source.noKind',
                p,
                'a source is {"dataset": ...}, {"artifact": ...} or {"inline": ...}'
            );
        }
    }

    for (const [vn, v] of Object.entries(variables)) {
        const options = v.options as PlainObject,
            p = `/variables/${vn}/options`;
        if (options == null) continue;
        if (isArray(options.values)) continue;
        if (!isString(options.source) || !isString(options.field)) {
            err(
                'variable.badOptions',
                p,
                'options are {"values": [...]} or {"source": ..., "field": ...}'
            );
        } else if (!sources[options.source]) {
            err('source.unknown', `${p}/source`, `unknown source '${options.source}'`);
        } else if (sourceFields[options.source] && !sourceFields[options.source][options.field]) {
            err(
                'field.unknown',
                `${p}/field`,
                `'${options.field}' is not a field of source '${options.source}'`
            );
        }
    }

    function checkJoin(sn: string, s: PlainObject, join: JoinDecl, p: string) {
        const other = sources[join?.source];
        if (!other) {
            err('join.unknownSource', `${p}/source`, `unknown source '${join?.source}'`);
            return;
        }
        if (join.source === sn) {
            err('join.self', `${p}/source`, 'a source cannot join itself');
            return;
        }
        const joinedBy = Object.keys(sources).find(
            n =>
                n !== sn &&
                castArray(sources[n].joins ?? []).some((j: JoinDecl) => j?.source === sn)
        );
        if (joinedBy) {
            err(
                'join.chained',
                p,
                `'${joinedBy}' joins '${sn}', so '${sn}' cannot join another: joins are one level deep`
            );
            return;
        }
        const primary = catalog.getDataset(s.dataset),
            secondary = catalog.getDataset(other.dataset);
        if (!primary || !secondary) {
            err('join.noKey', `${p}/source`, 'a join is between two dataset sources');
            return;
        }
        for (const [pf, sf] of Object.entries(join.on ?? {})) {
            const a = primary.fields[pf],
                b = secondary.fields[sf];
            if (!a || !b) {
                err(
                    'join.unknownField',
                    `${p}/on/${pf}`,
                    `'${a ? sf : pf}' is not a field of ${a ? other.dataset : s.dataset}`
                );
            } else if (a.type !== b.type) {
                err(
                    'join.typeMismatch',
                    `${p}/on/${pf}`,
                    `'${pf}' is a ${a.type}, but '${sf}' is a ${b.type}`
                );
            }
        }
        const names = new Set(Object.keys(primary.fields));
        Object.values(sourceFields[sn] ?? {}).forEach(it => names.add(it.name));
        castArray(join.fields ?? []).forEach((f: string, i: number) => {
            const name = join.as?.[f] ?? f;
            if (!secondary.fields[f]) {
                err(
                    'join.unknownField',
                    `${p}/fields/${i}`,
                    `'${f}' is not a field of ${other.dataset}`
                );
            } else if (names.has(name)) {
                err(
                    'join.fieldCollision',
                    `${p}/fields/${i}`,
                    `'${name}' is taken on '${sn}'. Name it with as.`
                );
            }
            names.add(name);
        });
        if (!primary.key?.length || !secondary.key?.length) {
            err(
                'join.noKey',
                `${p}/source`,
                `${primary.key?.length ? other.dataset : s.dataset} declares no key, so the join has no grain`
            );
            return;
        }
        const fields = joinFields(join, primary, secondary),
            keyed = fields.some(it => it.mode === 'keyed'),
            reduces = fields.some(it => it.reduce);
        for (const [pf, sf] of Object.entries(join.on ?? {})) {
            const own = primary.fields[pf],
                other = secondary.fields[sf];
            // Keyed values show on the rows that pin a dimension, and a reduce groups by them.
            if ((keyed && own && !own.isDimension) || (reduces && other && !other.isDimension)) {
                err(
                    'join.keyNotDimension',
                    `${p}/on/${pf}`,
                    `'${own?.isDimension ? sf : pf}' is not a dimension, so the join cannot key on it`
                );
            }
        }
        fields.forEach(jf => {
            const at = `${p}/fields/${join.fields.indexOf(jf.field)}`,
                agg = jf.def.aggregator as PlainObject | string;
            if (jf.reduce && agg == null) {
                err(
                    'join.noReduction',
                    at,
                    `'${jf.field}' has no aggregator, so its rows cannot reduce to the join's key`
                );
            } else if (
                jf.reduce &&
                isPlainObject(agg) &&
                ['last', 'first'].includes((agg as PlainObject).type) &&
                !(agg as PlainObject).orderField
            ) {
                err(
                    'join.lastNeedsOrder',
                    at,
                    `'${jf.field}' reduces by ${(agg as PlainObject).type}, which needs an orderField`
                );
            }
        });
        Object.keys(s.params ?? {})
            .filter(
                pn =>
                    Object.hasOwn(other.params ?? {}, pn) &&
                    !isEqual(s.params[pn], other.params[pn])
            )
            .forEach(pn =>
                warn(
                    'join.paramMismatch',
                    `${p}/source`,
                    `'${sn}' and '${join.source}' bind '${pn}' differently`
                )
            );
        sourceFields[sn] ??= toLookup({});
        fields.forEach(jf => {
            if (!primary.fields[jf.name]) sourceFields[sn][jf.name] = jf.def;
            if (jf.mode === 'keyed') (keyedFields[sn] ??= new Set()).add(jf.name);
        });
    }

    // Joins, each bringing another dataset source's fields onto this source's rows.
    for (const [sn, s] of Object.entries(sources)) {
        castArray(s.joins ?? []).forEach((join: JoinDecl, i: number) =>
            checkJoin(sn, s, join, `/sources/${sn}/joins/${i}`)
        );
    }

    // A template's references, each to a variable, a field of its source, or a source's field.
    // A title reads variables only, as it has no source to read a field from.
    const checkTemplate = (
        text: string,
        path: string,
        defaultSource: string,
        variablesOnly = false
    ) => {
        const literal = parseTemplate(text).parts.filter(isString).join(' ');
        if (!isAnswer && LITERAL_FIGURE.test(literal)) {
            warn(
                'template.literalFigure',
                path,
                'holds a figure, which goes stale as the data moves: read it with {source.field}, and put analysis in your reply'
            );
        }
        templateRefs(text).forEach(({ref, source, name}) => {
            if (!source && variables[name]) return;
            if (variablesOnly) {
                if (source) {
                    err(
                        'template.variablesOnly',
                        path,
                        `'{${ref}}' reads a source, but a title reads variables only: write {variable}`
                    );
                } else {
                    err('template.unknownRef', path, `'{${ref}}' names no variable`);
                }
                return;
            }
            const from = source ?? defaultSource,
                field = sourceFields[from]?.[name];
            if (!source && !field) {
                const orField = defaultSource ? ` or field of source '${defaultSource}'` : '';
                err('template.unknownRef', path, `'{${ref}}' names no variable${orField}`);
            } else if (!sources[from]) {
                err('source.unknown', path, `'{${ref}}' names unknown source '${source}'`);
            } else if (sourceFields[from] && !field) {
                err('field.unknown', path, `'${name}' is not a field of source '${source}'`);
            } else if (
                field?.aggregator === 'UNIQUE' &&
                ['number', 'int'].includes(field.type) &&
                !sources[from]?.inline
            ) {
                warn(
                    'template.unique',
                    path,
                    `'{${ref}}' totals only where every row agrees, so it often shows blank`
                );
            }
        });
        parseTemplate(text).badRefs.forEach(raw =>
            err(
                'template.badRef',
                path,
                `'${raw}' is not a reference. Write {variable} or {source.field}, and {{ or }} for a brace.`
            )
        );
    };

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
        const spec = registry.widgets[el.component],
            props: PlainObject = spec?.config?.properties ?? {};
        templateStrings(cfg, spec?.config).forEach(({text, path, mode}) =>
            checkTemplate(text, `${p}${toPointer(path)}`, cfg.source, mode === 'variables')
        );
        (el.children ?? []).forEach((ref, i) =>
            templateStrings(ref, spec?.children?.schema).forEach(({text, path}) =>
                checkTemplate(text, `/elements/${id}/children/${i}${toPointer(path)}`, null, true)
            )
        );
        Object.entries(props).forEach(([key, prop]) => {
            const bound = isPlainObject(cfg[key]) ? variables[cfg[key].$var] : null,
                want = prop?.['x-binding'] && bound ? bindingTypesOf(prop) : null;
            if (want && !want.some(it => typeMatches(bound.type, it))) {
                err(
                    'binding.typeMismatch',
                    `${p}/${key}`,
                    `${key} takes a ${want.join(' or ')}, but '${cfg[key].$var}' is a ${bound.type}`
                );
            } else if (want) {
                const bad = boundValues(bound).find(it => !fitsProp(it, prop));
                if (bad !== undefined) {
                    err(
                        'binding.outOfRange',
                        `${p}/${key}`,
                        `'${cfg[key].$var}' may hold ${JSON.stringify(bad)}, which ${key} does not take`
                    );
                }
            }
            if (prop?.['x-preset'] && isString(cfg[key]) && !getOwn(bp.presets, cfg[key])) {
                err('preset.unknownGroup', `${p}/${key}`, `unknown preset group '${cfg[key]}'`);
            }
        });
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
        if (isPlainObject(cfg.columns)) {
            Object.keys(cfg.columns).forEach(f => {
                if (f !== TREE_COLUMN) need(f, `${p}/columns/${f}`);
            });
        }
        // A heatmap's axes group its rows, so each is a dimension.
        const axisRole = el.component === 'heatmap' ? 'dimension' : undefined;
        if (cfg.x) need(cfg.x, `${p}/x`, axisRole);
        if (isString(cfg.y)) need(cfg.y, `${p}/y`, axisRole);
        if (isArray(cfg.y)) cfg.y.forEach((y: string, i: number) => need(y, `${p}/y/${i}`));
        if (isArray(cfg.y2)) cfg.y2.forEach((y: string, i: number) => need(y, `${p}/y2/${i}`));
        if (isArray(cfg.fields)) {
            cfg.fields.forEach((it: unknown, i: number) =>
                isString(it)
                    ? need(it, `${p}/fields/${i}`)
                    : need((it as PlainObject)?.field, `${p}/fields/${i}/field`)
            );
        }
        ['field', 'deltaField', 'value', 'heat', 'trend'].forEach(key => {
            if (isString(cfg[key])) need(cfg[key], `${p}/${key}`);
        });
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
        // A grid's style rules: fields in each rule, colors from the allowlist, and caps.
        const checkStyles = (rules: unknown, at: string) => {
            if (!isArray(rules)) return;
            if (rules.length > MAX_STYLE_RULES) {
                err(
                    'style.tooManyRules',
                    at,
                    `holds ${rules.length} rules, past the cap of ${MAX_STYLE_RULES}`
                );
            }
            rules.forEach((rule: PlainObject, i) => {
                const ruleAt = `${at}/${i}`;
                walk(rule?.when, (o, path) => {
                    if (!isPlainObject(o) || !('field' in o) || !('op' in o)) return;
                    need(o.field, `${ruleAt}/when${path}/field`);
                    const f = fields?.[o.field],
                        // A number with no aggregator shows blank on a group row, and a keyed
                        // value on one that does not pin its key.
                        blank =
                            (f && ['number', 'int'].includes(f.type) && f.aggregator == null) ||
                            keyedFields[cfg.source]?.has(o.field);
                    if (rule.rows === 'groups' && blank) {
                        warn(
                            'style.foldsNothing',
                            `${ruleAt}/when`,
                            `'${o.field}' shows blank on group rows, or on those that miss its join's key, so a groups rule on it may never match`
                        );
                    }
                });
                (['color', 'background'] as const).forEach(key => {
                    const v = rule?.style?.[key];
                    if (v != null && isString(v) && !isStyleColor(v, key === 'color')) {
                        err(
                            'style.badColor',
                            `${ruleAt}/style/${key}`,
                            `'${v}' is not ${key === 'color' ? 'an intent, muted' : 'an intent'} or a #rrggbb color`
                        );
                    }
                });
            });
        };
        if (isPlainObject(cfg.columns)) {
            Object.entries<PlainObject>(cfg.columns).forEach(([f, col]) =>
                checkStyles(col?.styles, `${p}/columns/${f}/styles`)
            );
        }
        checkStyles(cfg.rowStyles, `${p}/rowStyles`);
        const shown = registry.widgets[el.component]?.demand?.(cfg)?.[cfg.source]?.fields ?? [];
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
            const where = isAnswer ? 'answers' : 'dashboards';
            if (spec.allowedIn && !spec.allowedIn.includes(where)) {
                err(
                    'action.notAllowedHere',
                    `${p}${path}/type`,
                    `${o.type} is for ${spec.allowedIn.join(' and ')} only, not ${where}`
                );
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
            // A param marked x-variable names a variable the action may set.
            for (const [k, schema] of Object.entries<PlainObject>(spec.params.properties ?? {})) {
                if (!schema?.['x-variable'] || !Object.hasOwn(o, k)) continue;
                const name = o[k];
                if (!isString(name) || !variables[name]) {
                    err(
                        'variable.unknown',
                        `${p}${path}/${k}`,
                        `unknown variable '${isString(name) ? name : JSON.stringify(name)}'. Name a variable, not a binding.`
                    );
                } else if (!settableFromOutside.has(name)) {
                    err(
                        'action.cannotSet',
                        `${p}${path}/${k}`,
                        `an action cannot set '${name}'. Give it setBy "action", "prompt" or a widget without an output.`
                    );
                }
            }
            if (
                o.type === 'setVariable' &&
                settableFromOutside.has(o.variable) &&
                variables[o.variable].type === 'filter' &&
                checkFilter(o.value).length
            ) {
                err('filter.invalid', `${p}${path}/value`, 'the value is not a filter');
            }
        });
    }

    // Presets: named groups, each controlling its own paths.
    const owner: Record<string, string> = toLookup({});
    const selected = new Set(
        Object.values(elements)
            .filter(it => it?.component === 'presetSelector')
            .map(it => it.config?.group)
    );
    for (const [gname, pre] of Object.entries<any>(bp.presets ?? {})) {
        if (!isAnswer && !selected.has(gname)) {
            warn(
                'preset.noSelector',
                `/presets/${gname}`,
                'no presetSelector shows the group, so it stays at its default. Add one beside the widget it controls.'
            );
        }
        const gp = `/presets/${gname}`;
        if (!isPlainObject(pre) || !isArray(pre.controls)) {
            err(
                'preset.badGroup',
                gp,
                `'${gname}' is not a preset group: {label, controls, default, items}`
            );
            continue;
        }
        if (!isPlainObject(pre.items) || isEmpty(pre.items)) {
            err(
                'preset.noItems',
                `${gp}/items`,
                `'${gname}' has no presets. Give it at least one.`
            );
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
        const checkPresetItems = (path: string, segs: string[]) => {
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
        };
        for (const [i, c] of pre.controls.entries()) {
            const path = String(c?.path),
                segs = path.startsWith('/') ? decodePointer(path) : [];
            const isVariableDefault =
                segs[0] === 'variables' && segs[2] === 'default' && segs.length === 3;
            if (
                !(isVariableDefault && variables[segs[1]]) &&
                (segs[0] !== 'elements' || segs[2] !== 'config' || !elements[segs[1]])
            ) {
                err(
                    'preset.badPath',
                    `${gp}/controls/${i}/path`,
                    `'${path}' must name a config path of an element, such as /elements/grid/config/columnState, or a variable's default, such as /variables/fund/default`
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
            if (isVariableDefault) {
                if (Object.hasOwn(variables[segs[1]], 'default')) {
                    err(
                        'preset.stillInConfig',
                        path,
                        'a default that presets control must leave the variable declaration'
                    );
                }
                checkPresetItems(path, segs);
                continue;
            }
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
            checkPresetItems(path, segs);
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

/**
 * How a source shows one of its fields, an instance or an override. Display only.
 * @internal
 */
export const FIELD_OVERRIDE_SCHEMA = {
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
    // A reference in a slot other than children holds the child's ID alone.
    SLOT_REF_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {id: {type: 'string'}}
    },
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

function accepts(rule: SlotAccepts, child: WidgetSpec): boolean {
    const {categories, widgets} = rule ?? {};
    if (!categories && !widgets) return true;
    return !!categories?.includes(child.category) || !!widgets?.includes(child.name);
}

// Such as "input widgets, separator and spacer".
function describeAccepts(rule: SlotAccepts): string {
    const {categories = [], widgets = []} = rule ?? {},
        items = [...(categories.length ? [`${joinAnd(categories)} widgets`] : []), ...widgets];
    return joinAnd(items);
}

function joinAnd(items: string[]): string {
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0];
}

/**
 * The variable types a bound property takes, from its schema, or null where its schema says
 * nothing a variable type matches, as for an object.
 */
function bindingTypesOf(schema: PlainObject): string[] {
    if (schema.enum) return ['string'];
    switch (schema.type) {
        case 'boolean':
            return ['bool'];
        case 'integer':
            return ['int', 'number'];
        case 'number':
            return ['number', 'int'];
        case 'string':
            return ['string', 'localDate'];
        case 'array':
            return schema.items?.type === 'string' ? ['string[]'] : null;
        default:
            return null;
    }
}

/**
 * A canvas places children freely, so they must not overlap or pass the last column. A cell
 * narrower than its widget takes clips it, which is worth a warning.
 */
function checkCanvasLayout(
    el: PlainObject,
    path: string,
    err: (code: string, path: string, message: string) => void,
    warn: (code: string, path: string, message: string) => void,
    specOf: (id: string) => WidgetSpec
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
        const minW = specOf(c.id)?.size?.min?.w;
        if (minW && c.w < minW) {
            warn(
                'layout.tooNarrow',
                `${at}/w`,
                `'${c.id}' is ${c.w} columns wide, narrower than the ${minW} its widget needs`
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

// The values a variable is known to take: its options list and its literal default.
function boundValues(v: VariableDecl): unknown[] {
    const options = v.options as PlainObject,
        def = v.default as PlainObject;
    return [
        ...(isArray(options?.values) ? options.values : []),
        ...(def && 'value' in def && def.value != null ? [def.value] : [])
    ];
}

/** True if a value falls within a config prop's enum and range, where it has them. */
export function fitsProp(value: unknown, prop: PlainObject): boolean {
    if (isArray(prop.enum) && !prop.enum.includes(value)) return false;
    if (isNumber(value)) {
        if (prop.minimum != null && value < prop.minimum) return false;
        if (prop.maximum != null && value > prop.maximum) return false;
    }
    return true;
}

// An amount, a percent, a decimal or a number with thousands separators: a figure from the data.
const LITERAL_FIGURE = /[$€£¥]\s?\d|\d\.\d|\b\d{1,3}(,\d{3})+\b|\d\s?%/;
