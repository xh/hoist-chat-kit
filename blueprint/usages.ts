import type {PlainObject} from '@xh/hoist/core';
import {isArray, isEmpty, isPlainObject, isString, omit, uniq} from 'lodash';
import {type Blueprint, fieldInstances, isFieldInstance} from './Blueprint';
import type {BlueprintRegistry} from './BlueprintRegistry';
import type {DataCatalog} from './DataCatalog';
import {getOwn} from './impl/pointer';

/** One place a blueprint uses a field: a JSON Pointer, and the instance it goes through, if any. */
export interface FieldUse {
    path: string;
    /** The source's field instance the use names, such as `retYtd` over `return`. */
    instance?: string;
    /** The parameters of that instance. */
    params?: PlainObject;
}

/** The fields a blueprint uses, by dataset, then by field name. */
export type FieldUsages = Record<string, Record<string, FieldUse[]>>;

/**
 * Every field of the catalog that a blueprint uses, by dataset, with each place it is used:
 * a widget's columns, grouping, filter, chart axes, cards or sort, a source's field instances and
 * filter, and the variables that feed them. A widget with no source of its own, such as a grouping
 * chooser or a filter button, and a variable's values, count for the datasets of the widgets that
 * read the variables they write. A field instance counts on its base field.
 */
export function fieldUsages(blueprint: Blueprint, catalog: DataCatalog): FieldUsages {
    const ret: FieldUsages = {};
    if (!blueprint) return ret;

    const sources = blueprint.sources ?? {},
        elements = blueprint.elements ?? {},
        variables = blueprint.variables ?? {},
        datasetOf = (source: unknown) => getOwn(sources, source)?.dataset ?? null,
        allDatasets = uniqueOf(Object.values(sources).map(it => it.dataset)),
        varDatasets: Record<string, Set<string>> = {},
        addVar = (name: string, ds: string) => {
            if (!Object.hasOwn(varDatasets, name)) varDatasets[name] = new Set();
            varDatasets[name].add(ds);
        },
        use = (ds: string, field: string, it: FieldUse) => {
            const byField = (ret[ds] ??= {});
            (Object.hasOwn(byField, field) ? byField[field] : (byField[field] = [])).push(it);
        };

    // Each variable a widget reads counts for its source's dataset.
    Object.values(elements).forEach(el => {
        const ds = datasetOf(el.config?.source);
        if (ds) varBindings(el.config).forEach(v => addVar(v, ds));
    });
    Object.values(sources).forEach(src => {
        if (src.dataset) varBindings(src.filter).forEach(v => addVar(v, src.dataset));
    });

    const mark = (datasets: string[], name: string, path: string) => {
            datasets.forEach(ds => {
                const fields = catalog.getDataset(ds)?.fields,
                    // A name may be an instance a source declares over the dataset.
                    inst = Object.values(sources)
                        .filter(s => s.dataset === ds)
                        .map(s => getOwn(fieldInstances(s), name))
                        .find(Boolean),
                    field = inst?.field ?? name;
                if (!getOwn(fields, field)) return;
                use(ds, field, inst ? {path, instance: name} : {path});
            });
        },
        datasetsOfVars = (names: string[]) => {
            const found = uniqueOf(
                names.flatMap(n => [...(Object.hasOwn(varDatasets, n) ? varDatasets[n] : [])])
            );
            return found.length ? found : allDatasets;
        };

    // Sources: their field instances and overrides, and their filters.
    Object.entries(sources).forEach(([id, src]) => {
        if (!src.dataset) return;
        const dsFields = catalog.getDataset(src.dataset)?.fields;
        Object.entries(src.fields ?? {}).forEach(([name, entry]) => {
            if (!isFieldInstance(entry) && getOwn(dsFields, name)) {
                use(src.dataset, name, {path: `/sources/${id}/fields/${name}`});
            }
        });
        Object.entries(fieldInstances(src)).forEach(([inst, def]) => {
            if (!getOwn(dsFields, def.field)) return;
            const it: FieldUse = {path: `/sources/${id}/fields/${inst}`, instance: inst};
            if (!isEmpty(def.params)) it.params = def.params;
            use(src.dataset, def.field, it);
        });
        fieldRefs(src.filter, `/sources/${id}/filter`).forEach(r =>
            mark([src.dataset], r.name, r.path)
        );
    });

    // Widgets: on their source's dataset, or through the variables they write.
    Object.entries(elements).forEach(([id, el]) => {
        const ds = datasetOf(el.config?.source),
            refs = fieldRefs(omit(el.config, 'source'), `/elements/${id}/config`);
        if (!refs.length) return;
        const datasets = ds ? [ds] : datasetsOfVars(writtenVars(id, el.config, variables));
        refs.forEach(r => mark(datasets, r.name, r.path));
    });

    // Variables: their values, and the field a widget writes them from.
    Object.entries(variables).forEach(([name, decl]) => {
        const datasets = datasetsOfVars([name]),
            path = `/variables/${name}`,
            value = (decl.default as PlainObject)?.value;
        if (isString(value)) mark(datasets, value, `${path}/default/value`);
        if (isArray(value)) {
            value.forEach((v, i) => {
                if (isString(v)) mark(datasets, v, `${path}/default/value/${i}`);
            });
        }
        fieldRefs(value, `${path}/default/value`).forEach(r => mark(datasets, r.name, r.path));

        const options = decl.options as PlainObject;
        if (options?.dataset && options.field) {
            mark([options.dataset], options.field, `${path}/options/field`);
        }
        const writers = [decl.setBy].flat().filter(isPlainObject) as PlainObject[];
        writers.forEach((w, i) => {
            if (!isString(w.field)) return;
            const ds = datasetOf(getOwn(elements, w.element)?.config?.source),
                at = isArray(decl.setBy) ? `${path}/setBy/${i}/field` : `${path}/setBy/field`;
            mark(ds ? [ds] : datasets, w.field, at);
        });
    });
    return ret;
}

/**
 * Every registry entry a blueprint uses, as `<kind>:<name>`, with the places it is used: each
 * widget an element is, each presentation it draws with, each variable type, resolver, action and
 * renderer. A renderer counts through the fields that render with it, as `<dataset>.<field>`.
 */
export function registryUsages(
    blueprint: Blueprint,
    registry: Pick<BlueprintRegistry, 'variableTypes'>,
    catalog: DataCatalog
): Record<string, string[]> {
    const ret: Record<string, string[]> = {};
    if (!blueprint) return ret;
    const mark = (id: string, path: string) =>
        (Object.hasOwn(ret, id) ? ret[id] : (ret[id] = [])).push(path);

    Object.entries(blueprint.elements ?? {}).forEach(([id, el]) => {
        mark(`widget:${el.component}`, `/elements/${id}/component`);
        const {presentation} = el.config ?? {};
        if (isString(presentation) && presentation !== 'panel') {
            mark(
                `presentation:${el.component}.${presentation}`,
                `/elements/${id}/config/presentation`
            );
        }
    });
    Object.entries(blueprint.variables ?? {}).forEach(([name, decl]) => {
        const type = decl.type?.replace(/\[]$/, '');
        if (getOwn(registry.variableTypes, type))
            mark(`variableType:${type}`, `/variables/${name}/type`);
    });
    walk(blueprint, '', (key, value, path) => {
        if (key === 'resolver' && isString(value)) mark(`resolver:${value}`, path);
        if (key === 'renderer') {
            const name = isString(value) ? value : (value as PlainObject)?.name;
            if (isString(name)) mark(`renderer:${name}`, path);
        }
        if (key === 'action') {
            [value].flat().forEach((a, i) => {
                const at = isArray(value) ? `${path}/${i}/type` : `${path}/type`;
                if (isString((a as PlainObject)?.type))
                    mark(`action:${(a as PlainObject).type}`, at);
            });
        }
    });
    Object.entries(fieldUsages(blueprint, catalog)).forEach(([ds, fields]) => {
        Object.keys(fields).forEach(f => {
            const spec = getOwn(catalog.getDataset(ds)?.fields, f)?.renderer,
                name = isString(spec) ? spec : (spec as PlainObject)?.name;
            if (isString(name)) mark(`renderer:${name}`, `${ds}.${f}`);
        });
    });
    Object.keys(ret).forEach(id => (ret[id] = uniq(ret[id])));
    return ret;
}

//------------------
// Implementation
//------------------
// Keys whose string value names a field, and keys whose array holds field names.
const FIELD_KEYS = ['field', 'x', 'sortBy', 'colId'],
    FIELD_LIST_KEYS = ['y', 'columnState', 'groupBy', 'dimensions', 'fields'],
    FIELD_MAP_KEYS = ['columns'];

function fieldRefs(o: unknown, path: string): {name: string; path: string}[] {
    const ret: {name: string; path: string}[] = [],
        visit = (v: unknown, p: string) => {
            if (isArray(v)) return v.forEach((it, i) => visit(it, `${p}/${i}`));
            if (!isPlainObject(v)) return;
            Object.entries(v as PlainObject).forEach(([k, val]) => {
                const at = `${p}/${k}`;
                if (FIELD_MAP_KEYS.includes(k) && isPlainObject(val)) {
                    // Keyed by field, as a grid's columns are.
                    Object.keys(val).forEach(name => ret.push({name, path: `${at}/${name}`}));
                } else if (FIELD_KEYS.includes(k) && isString(val)) {
                    ret.push({name: val.split('|')[0], path: at});
                } else if (FIELD_LIST_KEYS.includes(k) && isArray(val)) {
                    val.forEach((it, i) =>
                        isString(it)
                            ? ret.push({name: it, path: `${at}/${i}`})
                            : visit(it, `${at}/${i}`)
                    );
                } else {
                    visit(val, at);
                }
            });
        };
    visit(o, path);
    return ret;
}

function varBindings(o: unknown): string[] {
    const ret: string[] = [];
    walk(o, '', (key, value) => {
        if (key === '$var' && isString(value)) ret.push(value);
    });
    return ret;
}

// The variables a widget sets: as its declared writer, or through its actions.
function writtenVars(id: string, config: PlainObject, variables: Blueprint['variables']): string[] {
    const byDecl = Object.entries(variables ?? {})
            .filter(([, d]) =>
                [d.setBy].flat().some(w => isPlainObject(w) && (w as PlainObject).element === id)
            )
            .map(([name]) => name),
        byAction: string[] = [];
    walk(config, '', (key, value) => {
        if (key === 'variable' && isString(value)) byAction.push(value);
    });
    return uniqueOf([...byDecl, ...byAction]);
}

function walk(o: unknown, path: string, fn: (key: string, value: unknown, path: string) => void) {
    if (isArray(o)) return o.forEach((it, i) => walk(it, `${path}/${i}`, fn));
    if (!isPlainObject(o)) return;
    Object.entries(o as PlainObject).forEach(([k, v]) => {
        const at = `${path}/${k}`;
        fn(k, v, at);
        walk(v, at, fn);
    });
}

function uniqueOf(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
