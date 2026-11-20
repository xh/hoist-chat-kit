import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject, isString, omit} from 'lodash';
import type {ReactNode} from 'react';
import type {Blueprint} from '../Blueprint';
import type {BlueprintRegistry, RendererContext, RendererSpec} from '../BlueprintRegistry';
import type {DataCatalog, FieldDef} from '../DataCatalog';
import {formatValue, type FormatLike, resolveFormat} from './formats';

/** A renderer as a blueprint or catalog names it: a name, or an object with a name and options. */
export type RendererLike = string | PlainObject;

/**
 * The renderer for a field: the widget's for that field if it names one, else the field's, which
 * the catalog takes from its kind unless the field names its own. The most specific replaces the
 * others whole. Null if none applies, or the registry has no `render` for it.
 */
export function resolveRenderer(
    field: FieldDef,
    widgetRenderer: RendererLike,
    registry: BlueprintRegistry
): {spec: RendererSpec; config: PlainObject} {
    const ref = (widgetRenderer ?? field.renderer) as RendererLike;
    if (!ref) return null;
    const name = isString(ref) ? ref : isPlainObject(ref) ? ref.name : null,
        spec = registry.renderers[name];
    if (!spec?.render) return null;
    return {spec, config: isString(ref) ? {} : omit(ref, 'name')};
}

/** How a widget shows one field: its format, then its renderer, if any. */
export interface FieldDisplay {
    render(value: unknown, record?: PlainObject, isAggregate?: boolean): ReactNode;
    exportValue(value: unknown, record?: PlainObject, isAggregate?: boolean): unknown;
}

/**
 * The display of a field in a widget, from the catalog, then each format given over its own, most
 * specific last, and the renderer given, if any. See `resolveFieldDisplay()` for the layers.
 */
export function fieldDisplay(
    field: FieldDef,
    overrides: {formats?: FormatLike[]; renderer?: RendererLike},
    ctx: {
        catalog: DataCatalog;
        blueprint: Blueprint;
        registry: BlueprintRegistry;
        /** The largest absolute value of the field among its rows. See `RendererContext`. */
        columnMax?: () => number;
    }
): FieldDisplay {
    const {catalog, blueprint, registry, columnMax} = ctx,
        format = resolveFormat(field, overrides.formats ?? [], {catalog, blueprint}),
        fmt = (v: unknown) => formatValue(v, field, format, catalog),
        resolved = resolveRenderer(field, overrides.renderer, registry),
        rendererCtx = (record: PlainObject, isAggregate: boolean): RendererContext => ({
            field,
            config: resolved.config,
            format,
            isAggregate,
            record,
            formatValue: fmt,
            ...(columnMax ? {columnMax} : {})
        });

    return {
        render: (value, record = null, isAggregate = false) =>
            resolved ? resolved.spec.render(value, rendererCtx(record, isAggregate)) : fmt(value),
        exportValue: (value, record = null, isAggregate = false) =>
            resolved?.spec.exportValue
                ? resolved.spec.exportValue(value, rendererCtx(record, isAggregate))
                : value
    };
}
