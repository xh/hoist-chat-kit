import {Ajv} from 'ajv';
import {Issue} from './engine.ts';
import {Blueprint, datasets, FieldDef, registry} from './load.ts';

const BUILTIN_TYPES = ['string', 'number', 'int', 'bool', 'date', 'localDate', 'filter'];
const FILTER_OPS = ['=', '!=', '>', '>=', '<', '<=', 'like', 'not like', 'begins', 'not begins', 'ends', 'not ends', 'includes', 'excludes'];
const BINDING = {type: 'object', required: ['$var'], properties: {$var: {type: 'string'}}, additionalProperties: false};
const DEFS = {
    binding: BINDING,
    filter: {
        anyOf: [
            {$ref: '#/$defs/binding'},
            {
                type: 'object',
                required: ['field', 'op'],
                additionalProperties: false,
                properties: {field: {type: 'string'}, op: {enum: FILTER_OPS}, value: {}}
            },
            {
                type: 'object',
                required: ['filters'],
                additionalProperties: false,
                properties: {filters: {type: 'array', items: {$ref: '#/$defs/filter'}}, op: {enum: ['AND', 'OR', 'and', 'or']}}
            }
        ]
    },
    format: {anyOf: [{type: 'string'}, {type: 'object'}]},
    renderer: {anyOf: [{type: 'string'}, {type: 'object', required: ['name'], properties: {name: {type: 'string'}}}]},
    action: {type: 'object', required: ['type'], properties: {type: {type: 'string'}}}
};

/** Turn the registry's annotations into plain JSON Schema for Ajv. */
function expand(schema: any): any {
    if (Array.isArray(schema)) return schema.map(expand);
    if (!schema || typeof schema !== 'object') return schema;
    let s: any = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, expand(v)]));
    if (s['x-filter']) s = {$ref: '#/$defs/filter'};
    if (s['x-format']) s = {$ref: '#/$defs/format'};
    if (s['x-renderer']) s = {$ref: '#/$defs/renderer'};
    if (s['x-action']) s = {$ref: '#/$defs/action'};
    if (schema['x-binding'] && !schema['x-filter']) s = {anyOf: [s, {$ref: '#/$defs/binding'}]};
    return s;
}

const ajv = new Ajv({allErrors: true, strict: false});
const configValidators: Record<string, any> = {},
    childValidators: Record<string, any> = {};
for (const [name, w] of Object.entries<any>(registry.widgets)) {
    configValidators[name] = ajv.compile({...expand(w.config), $defs: DEFS});
    if (w.children) childValidators[name] = ajv.compile(w.children);
}
const filterValidator = ajv.compile({$ref: '#/$defs/filter', $defs: DEFS});

function walk(o: any, fn: (v: any, path: string) => void, path = '') {
    fn(o, path);
    if (Array.isArray(o)) o.forEach((v, i) => walk(v, fn, `${path}/${i}`));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, fn, `${path}/${k}`);
}

const typeMatches = (varType: string, want: string) => {
    if (varType === want) return true;
    const app = registry.variableTypes[varType];
    return app?.matches === want;
};

export interface ValidateContext {
    /** Dataset behind each artifact a chat answer can name. */
    artifacts: Record<string, string>;
    /** True for a chat answer, which may hold artifacts and inline sources. */
    isAnswer?: boolean;
}

/** Check a blueprint against the spec, the registry and the catalogs. */
export function validate(bp: Blueprint, ctx: ValidateContext): Issue[] {
    const issues: Issue[] = [],
        err = (code: string, path: string, message: string) => issues.push({code, severity: 'error', path, message}),
        warn = (code: string, path: string, message: string) => issues.push({code, severity: 'warning', path, message});

    const allowed = ['schema', 'formats', 'variables', 'sources', 'presets', 'root', 'elements'];
    for (const k of Object.keys(bp)) if (!allowed.includes(k)) err('structure.unknownKey', `/${k}`, `unknown top-level key '${k}'. Allowed: ${allowed.join(', ')}`);

    const elements: Record<string, any> = bp.elements ?? {},
        variables: Record<string, any> = bp.variables ?? {},
        sources: Record<string, any> = bp.sources ?? {};

    // Structure.
    if (!bp.root) err('structure.noRoot', '/root', 'the blueprint has no root element');
    else if (!elements[bp.root]) err('structure.unknownRoot', '/root', `root '${bp.root}' is not an element`);
    const parent: Record<string, string> = {};
    for (const [id, el] of Object.entries(elements)) {
        const p = `/elements/${id}`;
        for (const k of Object.keys(el)) {
            if (!['component', 'config', 'children', 'personalizable'].includes(k)) err('structure.unknownKey', `${p}/${k}`, `unknown element key '${k}'`);
        }
        const spec = registry.widgets[el.component];
        if (!spec) {
            err('element.unknownComponent', `${p}/component`, `unknown component '${el.component}'. Use describe_registry to list widgets.`);
            continue;
        }
        if (!configValidators[el.component](el.config ?? {})) {
            for (const e of configValidators[el.component].errors ?? []) {
                if (e.keyword === 'anyOf' || e.keyword === '$ref') continue;
                err('schema.invalid', `${p}/config${e.instancePath}`, `${e.message}${e.params?.additionalProperty ? `: '${e.params.additionalProperty}'` : ''}${e.params?.allowedValues ? `: ${e.params.allowedValues.join(', ')}` : ''}`);
            }
        }
        if (el.children && !spec.children) err('element.notContainer', `${p}/children`, `${el.component} takes no children`);
        if (el.component === 'dashCanvas') {
            const cols = el.config?.columns ?? 12,
                kids = (el.children ?? []).filter((c: any) => [c.x, c.y, c.w, c.h].every(Number.isInteger));
            kids.forEach((c: any, i: number) => {
                if (c.x + c.w > cols) err('layout.outOfBounds', `${p}/children/${i}`, `'${c.id}' reaches column ${c.x + c.w}, past the last of ${cols}`);
                kids.slice(i + 1).forEach((d: any) => {
                    if (c.x < d.x + d.w && d.x < c.x + c.w && c.y < d.y + d.h && d.y < c.y + c.h) err('layout.overlap', `${p}/children/${i}`, `'${c.id}' overlaps '${d.id}'`);
                });
            });
        }
        for (const [i, ch] of (el.children ?? []).entries()) {
            if (spec.children && !childValidators[el.component](ch)) {
                for (const e of childValidators[el.component].errors ?? []) err('schema.invalid', `${p}/children/${i}${e.instancePath}`, `${e.message}${e.params?.additionalProperty ? `: '${e.params.additionalProperty}'` : ''}`);
            }
            if (!elements[ch.id]) err('structure.unknownChild', `${p}/children/${i}/id`, `child '${ch.id}' is not an element`);
            else if (ch.id === bp.root) err('structure.rootIsChild', `${p}/children/${i}/id`, `'${ch.id}' is the root`);
            else if (parent[ch.id]) err('structure.twoParents', `${p}/children/${i}/id`, `'${ch.id}' is already a child of '${parent[ch.id]}'`);
            else parent[ch.id] = id;
        }
    }
    for (const id of Object.keys(elements)) {
        if (id !== bp.root && !parent[id]) err('structure.notPlaced', `/elements/${id}`, `element '${id}' has no parent, so it never shows`);
    }

    // Variables and their writers.
    const settableFromOutside = new Set<string>();
    for (const [vn, v] of Object.entries(variables)) {
        const p = `/variables/${vn}`,
            baseType = String(v.type ?? '').replace(/\[\]$/, '');
        if (!BUILTIN_TYPES.includes(baseType) && !registry.variableTypes[baseType]) err('variable.unknownType', `${p}/type`, `unknown type '${v.type}'`);
        const sb = v.setBy,
            writers = Array.isArray(sb) ? sb : sb && typeof sb === 'object' ? [sb] : [];
        if (typeof sb === 'string' && !['prompt', 'resolver', 'action'].includes(sb)) err('variable.badSetBy', `${p}/setBy`, `setBy must be "prompt", "resolver", "action", {"element": id} or {"element": id, "output": name}`);
        if (sb === 'resolver' && !v.compute) err('variable.noCompute', p, 'a variable set by a resolver needs compute');
        if (sb !== 'resolver' && v.compute) err('variable.computeWithoutResolver', `${p}/compute`, 'compute needs setBy "resolver"');
        for (const r of [v.compute, v.default].filter(Boolean)) {
            if (r.resolver && !registry.resolvers[r.resolver]) err('variable.unknownResolver', p, `unknown resolver '${r.resolver}'`);
        }
        if (v.default && !('value' in v.default) && !v.default.resolver) err('variable.badDefault', `${p}/default`, 'a default is {"value": ...} or {"resolver": ..., "args": ...}');
        if (sb === 'prompt' || sb === 'action' || (writers.length === 1 && !writers[0].output)) settableFromOutside.add(vn);
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
                const out = (spec.outputs ?? []).find((o: any) => o.name === w.output);
                if (!out) err('variable.unknownOutput', wp, `${el.component} has no output '${w.output}'. Outputs: ${(spec.outputs ?? []).map((o: any) => o.name).join(', ') || 'none'}`);
                else if (out.type === 'filter' && v.type !== 'filter') err('variable.typeMismatch', `${p}/type`, `output '${w.output}' is a filter, but the variable is a ${v.type}`);
                else if (out.args?.field && !w.field) err('variable.missingArg', wp, `output '${w.output}' needs a field`);
            } else if (!spec.value) {
                err('variable.cannotShowValue', wp, `${el.component} cannot show and set a value. Name one of its outputs, or use a different writer.`);
            } else if (spec.value.type !== v.type && !typeMatches(v.type, spec.value.type)) {
                err('variable.typeMismatch', `${p}/type`, `${el.component} sets a ${spec.value.type}, but the variable is a ${v.type}`);
            }
        }
        if (writers.length > 1 && v.type !== 'filter') err('variable.writerConflict', `${p}/setBy`, 'only a filter variable can have several writers');
        if (v.default?.personalizable && (sb === 'resolver' || writers.some((w: any) => w.output))) err('variable.notPersonalizable', `${p}/default/personalizable`, 'a variable set by an output or a resolver cannot be personalizable');
    }

    walk(bp, (o, path) => {
        if (o && typeof o === 'object' && '$var' in o && !variables[o.$var]) err('variable.unknown', path, `unknown variable '${o.$var}'`);
    });

    // Sources.
    const sourceFields: Record<string, Record<string, FieldDef>> = {};
    for (const [sn, s] of Object.entries(sources)) {
        const p = `/sources/${sn}`;
        if (s.dataset) {
            const ds = datasets[s.dataset];
            if (!ds) {
                err('source.unknownDataset', `${p}/dataset`, `unknown dataset '${s.dataset}'`);
                continue;
            }
            for (const [pn, pv] of Object.entries<any>(s.params ?? {})) {
                const pd = ds.params[pn];
                if (!pd) err('source.unknownParam', `${p}/params/${pn}`, `${s.dataset} has no parameter '${pn}'. Parameters: ${Object.keys(ds.params).join(', ')}`);
                else if (!ctx.isAnswer && !(pv && typeof pv === 'object' && '$var' in pv)) {
                    err('source.literalParam', `${p}/params/${pn}`, `bind parameter '${pn}' to a variable. A blueprint holds no literal parameter values: use a prompted variable, or a variable with no setBy for a constant.`);
                } else if (pv?.$var && variables[pv.$var] && !typeMatches(variables[pv.$var].type, pd.type)) {
                    err('variable.typeMismatch', `${p}/params/${pn}`, `parameter '${pn}' takes a ${pd.type}, but variable '${pv.$var}' is a ${variables[pv.$var].type}`);
                }
            }
            for (const [pn, pd] of Object.entries(ds.params)) {
                if (pd.required && !(pn in (s.params ?? {}))) err('source.missingParam', `${p}/params`, `${s.dataset} requires parameter '${pn}'`);
            }
            const fields = {...ds.fields};
            for (const [iname, inst] of Object.entries<any>(s.fields ?? {})) {
                const base = ds.fields[inst.field];
                if (!base?.params) err('source.badInstance', `${p}/fields/${iname}`, `'${inst.field}' is not a parameterized field of ${s.dataset}`);
                else fields[iname] = base;
            }
            sourceFields[sn] = fields;
        } else if (s.artifact) {
            if (!ctx.isAnswer) warn('source.artifactOutsideAnswer', p, 'only a chat answer should read an artifact. Use a dataset source.');
            const dsName = ctx.artifacts[s.artifact];
            if (!dsName) err('source.unknownArtifact', `${p}/artifact`, `unknown artifact '${s.artifact}'`);
            else sourceFields[sn] = datasets[dsName].fields;
        } else if (s.inline) {
            if (!ctx.isAnswer) warn('source.inlineOutsideAnswer', p, 'outside a chat answer, inline data must not hold values computed from a source');
            sourceFields[sn] = Object.fromEntries((s.inline.fields ?? []).map((f: FieldDef) => [f.name, f]));
        } else {
            err('source.noKind', p, 'a source is {"dataset": ...}, {"artifact": ...} or {"inline": ...}');
        }
    }

    // Field references, actions.
    for (const [id, el] of Object.entries(elements)) {
        const cfg = el.config ?? {},
            p = `/elements/${id}/config`;
        if (cfg.source !== undefined && !sources[cfg.source]) {
            err('source.unknown', `${p}/source`, `unknown source '${cfg.source}'`);
            continue;
        }
        const fields = sourceFields[cfg.source];
        const need = (name: string, path: string, role?: 'dimension') => {
            if (!fields || typeof name !== 'string') return;
            const f = fields[name];
            if (!f) err('field.unknown', path, `'${name}' is not a field of source '${cfg.source}'`);
            else if (role === 'dimension' && !f.isDimension) err('field.notDimension', path, `'${name}' is not a dimension`);
            else if (f.deprecated) warn('field.deprecated', path, `'${name}' is deprecated. Use '${f.replacedBy}'.`);
        };
        if (Array.isArray(cfg.groupBy)) cfg.groupBy.forEach((g: string, i: number) => need(g, `${p}/groupBy/${i}`, 'dimension'));
        (cfg.columnState ?? []).forEach((c: any, i: number) => {
            const f = typeof c === 'string' ? c : c?.field;
            if (f !== 'group') need(f, `${p}/columnState/${i}`);
        });
        if (cfg.x) need(cfg.x, `${p}/x`);
        (cfg.y ?? []).forEach((y: string, i: number) => need(y, `${p}/y/${i}`));
        if (typeof cfg.groupBy === 'string') need(cfg.groupBy, `${p}/groupBy`, 'dimension');
        (cfg.cards ?? []).forEach((c: any, i: number) => (c.field ? need(c.field, `${p}/cards/${i}/field`) : c.agg !== 'count' && err('schema.invalid', `${p}/cards/${i}`, 'a card needs a field, unless its agg is count')));
        [cfg.sortBy].flat().forEach((sb: unknown, i: number) => {
            const f = typeof sb === 'string' ? sb.split('|')[0] : null;
            if (f && f !== 'group') need(f, Array.isArray(cfg.sortBy) ? `${p}/sortBy/${i}` : `${p}/sortBy`);
        });
        if (Array.isArray(cfg.dimensions)) cfg.dimensions.forEach((d: string, i: number) => need(d, `${p}/dimensions/${i}`, 'dimension'));
        walk(cfg.filter, (o, path) => {
            if (o && typeof o === 'object' && 'field' in o && 'op' in o) need(o.field, `${p}/filter${path}/field`);
        });
        walk(cfg, (o, path) => {
            if (!o || typeof o !== 'object' || !o.type || !path.endsWith('/action')) return;
            const spec = registry.actions[o.type];
            if (!spec) return err('action.unknown', `${p}${path}/type`, `unknown action '${o.type}'. Actions: ${Object.keys(registry.actions).join(', ')}`);
            for (const k of Object.keys(o)) if (k !== 'type' && k !== 'confirm' && !(k in spec.params)) err('action.unknownParam', `${p}${path}/${k}`, `${o.type} takes no '${k}'`);
            if (o.type === 'setVariable' || o.type === 'resetVariable') {
                if (!variables[o.variable]) err('variable.unknown', `${p}${path}/variable`, `unknown variable '${o.variable}'`);
                else if (!settableFromOutside.has(o.variable)) err('action.cannotSet', `${p}${path}/variable`, `an action cannot set '${o.variable}'. Give it setBy "action", "prompt" or a widget without an output.`);
                else if (o.type === 'setVariable' && variables[o.variable].type === 'filter' && !filterValidator(o.value)) err('filter.invalid', `${p}${path}/value`, 'the value is not a filter');
            }
        });
    }

    // Presets: named groups, each controlling its own paths.
    const owner: Record<string, string> = {};
    for (const [gname, pre] of Object.entries<any>(bp.presets ?? {})) {
        const gp = `/presets/${gname}`;
        if (!pre || typeof pre !== 'object' || !Array.isArray(pre.controls)) {
            err('preset.badGroup', gp, `'${gname}' is not a preset group: {label, controls, default, items}`);
            continue;
        }
        for (const k of Object.keys(pre)) if (!['label', 'controls', 'default', 'items'].includes(k)) err('structure.unknownKey', `${gp}/${k}`, `unknown preset group key '${k}'. A group has label, controls, default and items.`);
        for (const [i, c] of pre.controls.entries()) {
            const path = c?.path,
                segs = String(path).split('/').slice(1);
            if (segs[0] !== 'elements' || segs[2] !== 'config' || !elements[segs[1]]) {
                err('preset.badPath', `${gp}/controls/${i}/path`, `'${path}' must name a config path of an element, such as /elements/grid/config/columnState`);
                continue;
            }
            if (owner[path]) err('preset.twoGroups', `${gp}/controls/${i}/path`, `'${path}' is already controlled by group '${owner[path]}'`);
            owner[path] = gname;
            const spec = registry.widgets[elements[segs[1]].component],
                rel = '/' + segs.slice(3).join('/');
            if (!(spec?.presetPaths ?? []).includes(rel)) err('preset.notPresetPath', `${gp}/controls/${i}/path`, `'${rel}' is not a preset path of ${elements[segs[1]].component}. Preset paths: ${(spec?.presetPaths ?? []).join(', ') || 'none'}`);
            if (segs[3] in (elements[segs[1]].config ?? {})) err('preset.stillInConfig', path, 'a path that presets control must leave the element config');
            for (const [iname, item] of Object.entries<any>(pre.items ?? {})) {
                let o = item?.set;
                for (const seg of segs) o = o?.[seg];
                if (o === undefined) err('preset.missingPath', `${gp}/items/${iname}/set`, `preset '${iname}' does not set ${path}`);
            }
        }
        if (pre.default && !pre.items?.[pre.default]) err('preset.unknownDefault', `${gp}/default`, `no preset '${pre.default}'`);
    }
    return issues;
}
