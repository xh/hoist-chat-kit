import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject, isString, keyBy, omit, pick, uniq} from 'lodash';
import {paramLabel} from './impl/paramLabel';
import {toLookup} from './impl/pointer';

/** Kinds every catalog has, beside `currency:<code>`. */
export const BUILT_IN_KINDS = ['fraction', 'bps', 'shares'];

/** A field of a dataset, as the Data Catalog declares it. */
export interface FieldDef {
    name: string;
    label?: string;
    /** A Hoist `FieldType`. */
    type: string;
    kind?: string;
    description?: string;
    guidance?: string;
    category?: string | string[];
    isDimension?: boolean;
    parentDimension?: string;
    isLeafDimension?: boolean;
    /** A Cube aggregator token, an object for one with config, or `"server"`. */
    aggregator?: string | PlainObject;
    format?: string | PlainObject;
    renderer?: string | PlainObject;
    /** How a grid aligns the field's column. Default right for a number, else left. */
    align?: 'left' | 'center' | 'right';
    /** A grid column's width in pixels, until a user sizes it. */
    width?: number;
    params?: Record<string, ParamDef>;
    deprecated?: boolean;
    replacedBy?: string;
}

/** A parameter of a dataset or a parameterized field. */
export interface ParamDef {
    type: string;
    /** Its name for users, as a variable made for it shows. Default its name in words. */
    label?: string;
    /** What a value means, as for a field. It formats the value, as in an instance's label. */
    kind?: string;
    required?: boolean;
    description?: string;
    options?: PlainObject;
}

/** A kind the catalog defines, over a built-in kind or a type. */
export interface KindDef {
    base: string;
    format?: string | PlainObject;
    aggregator?: string | PlainObject;
    renderer?: string | PlainObject;
}

export interface DatasetDef {
    name: string;
    label?: string;
    description?: string;
    guidance?: string;
    params: Record<string, ParamDef>;
    /**
     * The fields that identify a row, which give a join its grain. Each must be a field of the
     * dataset. A join that keys on one by group, as a coarser value or a reduce does, also needs it
     * to be a dimension (`join.keyNotDimension`).
     */
    key?: string[];
    /** Every field, keyed by name, with shared fields and kind defaults resolved. */
    fields: Record<string, FieldDef>;
}

/** The JSON form of a Data Catalog. */
export interface DataCatalogJson {
    version?: number;
    label?: string;
    formats?: Record<string, PlainObject>;
    kinds?: Record<string, KindDef>;
    fields?: FieldDef[];
    datasets: Record<string, Omit<DatasetDef, 'name' | 'fields'> & {fields: (string | FieldDef)[]}>;
}

/**
 * The universe of datasets, their parameters and their fields, shared by all blueprints. Built
 * from the catalog's JSON, which the app supplies.
 */
export class DataCatalog {
    readonly json: DataCatalogJson;
    readonly formats: Record<string, PlainObject>;
    readonly kinds: Record<string, KindDef>;
    readonly datasets: Record<string, DatasetDef>;

    constructor(json: DataCatalogJson) {
        this.json = json;
        this.formats = toLookup(json.formats);
        this.kinds = toLookup(json.kinds);

        const shared = toLookup(keyBy(json.fields ?? [], 'name'));
        this.datasets = toLookup({});
        const problems: string[] = [],
            checkKind = (kind: string, what: string) => {
                if (kind != null && !this.isKnownKind(kind))
                    problems.push(`unknown kind '${kind}' on ${what}`);
            };
        Object.entries(json.datasets).forEach(([name, ds]) => {
            const fields = ds.fields.map(it =>
                this.withKindDefaults(isString(it) ? shared[it] : it)
            );
            this.datasets[name] = {
                ...ds,
                name,
                params: toLookup(ds.params),
                fields: toLookup(keyBy(fields, 'name'))
            };
            Object.entries(ds.params ?? {}).forEach(([pn, pd]) =>
                checkKind(pd.kind, `parameter '${pn}' of dataset '${name}'`)
            );
            // A join takes its grain from the key, so a key that names no field gives wrong numbers.
            (ds.key ?? [])
                .filter(it => !fields.some(f => f.name === it))
                .forEach(it =>
                    problems.push(`key field '${it}' of dataset '${name}' is not one of its fields`)
                );
            fields.forEach(f => {
                checkKind(f.kind, `field '${f.name}' of dataset '${name}'`);
                this.checkParamLabel(f, name, ds.params ?? {}, problems);
                Object.entries(f.params ?? {}).forEach(([pn, pd]) =>
                    checkKind(pd.kind, `parameter '${pn}' of field '${f.name}'`)
                );
            });
        });
        if (problems.length) throw new Error(`Invalid Data Catalog: ${uniq(problems).join('; ')}`);
    }

    /** True for a built-in kind, such as `fraction` or `currency:USD`, or one the catalog defines. */
    isKnownKind(kind: string): boolean {
        return (
            BUILT_IN_KINDS.includes(kind) || /^currency:[A-Z]{3}$/.test(kind) || !!this.kinds[kind]
        );
    }

    getDataset(name: string): DatasetDef {
        return this.datasets[name] ?? null;
    }

    // A format label a param chooses names a param of the dataset, and gives text for each value.
    private checkParamLabel(
        field: FieldDef,
        dataset: string,
        params: Record<string, ParamDef>,
        problems: string[]
    ) {
        const expand = (f: unknown): PlainObject => {
                if (f == null) return {};
                if (isString(f)) return this.formats[f] ?? {};
                const it = f as PlainObject;
                return isString(it.name) ? {...expand(it.name), ...omit(it, 'name')} : it;
            },
            kind = this.kinds[field.kind],
            label = paramLabel({...expand(kind?.format), ...expand(field.format)}.label),
            what = `the format label of field '${field.name}' of dataset '${dataset}'`;
        if (!label) return;
        if (!params[label.param]) {
            problems.push(`${what} reads param '${label.param}', which the dataset does not take`);
        } else if (!isPlainObject(label.values) || !Object.values(label.values).every(isString)) {
            problems.push(`${what} needs text for each value of '${label.param}'`);
        }
    }

    private withKindDefaults(field: FieldDef): FieldDef {
        const kind = this.kinds[field.kind];
        return kind ? {...pick(kind, 'format', 'aggregator', 'renderer'), ...field} : field;
    }
}
