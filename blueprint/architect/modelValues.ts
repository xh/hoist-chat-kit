import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject, isString} from 'lodash';
import type {Blueprint, VariableDecl} from '../Blueprint';
import type {DataCatalog, ModelAccess} from '../DataCatalog';
import {filterFields} from '../impl/bindings';
import {getWriters} from '../validateBlueprint';

/** What the model gets in place of a value from data it may not read: that one is set, and its type. */
export interface WithheldValue {
    withheld: true;
    type: string;
}

/**
 * Each variable's current value, as the model may see it. A value that comes from data the
 * catalog closes to the model (`modelAccess` other than `rows`) becomes a {@link WithheldValue}: a
 * widget output over a closed field, such as a grid selection, a value chosen from a closed
 * field's values, as a prompt or a link sets it, and a resolver's result that reads either.
 */
export function variablesForModel(model: {
    blueprint: Blueprint;
    catalogs: DataCatalog[];
    variables: {name: string; value: unknown; isSet: boolean}[];
}): Record<string, unknown> {
    const {blueprint: bp, catalogs, variables} = model,
        decls = bp?.variables ?? {},
        byName = new Map(variables.map(it => [it.name, it])),
        memo = new Map<string, boolean>();

    const datasetAccess = (source: string): ModelAccess => {
        const ds = bp?.sources?.[source]?.dataset;
        if (!ds) return 'rows';
        return catalogs.find(it => it.getDataset(ds))?.modelAccessOf(ds) ?? 'schema';
    };

    // A field of a source, by its name on the source: an instance's base field, or a joined field's
    // own on the source it joins. A name it cannot place takes its dataset's access.
    const fieldAccess = (source: string, field: string, depth = 0): ModelAccess => {
        const src = bp?.sources?.[source],
            cat = src?.dataset ? catalogs.find(it => it.getDataset(src.dataset)) : null;
        if (!src?.dataset) return 'rows';
        if (!cat || depth > 8) return 'schema';
        const base = (src.fields?.[field] as PlainObject)?.field ?? field;
        if (cat.getDataset(src.dataset).fields[base]) return cat.modelAccessOf(src.dataset, base);
        for (const join of src.joins ?? []) {
            const own = join.fields.find(it => (join.as?.[it] ?? it) === field);
            if (own) return fieldAccess(join.source, own, depth + 1);
        }
        return cat.modelAccessOf(src.dataset);
    };

    const fromClosedWriter = (decl: VariableDecl, value: unknown): boolean => {
        const writers = getWriters(decl);
        return writers.some(w => {
            const config = bp.elements?.[w.element]?.config as PlainObject,
                source = config?.source;
            if (!isString(source)) return false;
            const field = w.field ?? (w.output ? null : config.field),
                fields = field
                    ? [field]
                    : decl.type === 'filter'
                      ? filterFields(value)
                      : isPlainObject(value)
                        ? Object.keys(value)
                        : null;
            return fields
                ? fields.some(f => fieldAccess(source, f) !== 'rows')
                : datasetAccess(source) !== 'rows';
        });
    };

    const readsClosed = (call: PlainObject, seen: string[]): boolean =>
        JSON.stringify(call?.args ?? {})
            .match(/"\$var":"([^"]+)"/g)
            ?.some(it => isClosed(it.slice(8, -1), seen)) ?? false;

    function isClosed(name: string, seen: string[] = []): boolean {
        if (memo.has(name)) return memo.get(name);
        const decl = decls[name],
            v = byName.get(name);
        if (!decl || !v || v.value == null || seen.includes(name)) return false;
        const next = [...seen, name],
            {options} = decl,
            ret =
                (!!options &&
                    'source' in options &&
                    fieldAccess(options.source, options.field) !== 'rows') ||
                fromClosedWriter(decl, v.value) ||
                (decl.setBy === 'resolver' && readsClosed(decl.compute, next)) ||
                (!v.isSet &&
                    decl.default &&
                    'resolver' in decl.default &&
                    readsClosed(decl.default, next));
        memo.set(name, ret);
        return ret;
    }

    return Object.fromEntries(
        variables.map(({name, value}) => [
            name,
            isClosed(name)
                ? ({withheld: true, type: decls[name]?.type} as WithheldValue)
                : (value ?? null)
        ])
    );
}
