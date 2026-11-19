import type {PlainObject} from '@xh/hoist/core';
import {isEqual, mapValues, pick, pickBy} from 'lodash';
import {type Blueprint, isVarBinding} from '../Blueprint';
import {getOwn} from '../impl/pointer';

/** A query's request as it maps into a host. See {@link hostSourceFor}. */
export interface HostSourceFor {
    /** The dataset source that gives the request's rows, with its params as the request set them. */
    source: {dataset: string; params: PlainObject};
    /** What the request set of `fields`, `groupBy`, `filter`, `sortBy` and `top`, for a widget. */
    config: PlainObject;
    /** The host's sources over the same dataset whose params, resolved now, equal the request's. */
    matches: string[];
}

/**
 * What a query's request, as `query_dataset` records it on an artifact, becomes in a host. Which
 * literal params to bind to the host's variables, and where the widget goes, stays a choice.
 */
export function hostSourceFor(
    request: PlainObject,
    host: {blueprint: Blueprint; variables?: {name: string; value: unknown}[]}
): HostSourceFor {
    const {dataset} = request,
        params = request.params ?? {},
        values = Object.fromEntries((host.variables ?? []).map(it => [it.name, it.value])),
        resolve = (v: unknown) => (isVarBinding(v) ? (getOwn(values, v.$var) ?? null) : v),
        matches = Object.entries(host.blueprint?.sources ?? {})
            .filter(
                ([, s]: [string, PlainObject]) =>
                    s?.dataset === dataset && isEqual(mapValues(s.params ?? {}, resolve), params)
            )
            .map(([name]) => name);
    return {
        source: {dataset, params},
        config: pickBy(pick(request, CONFIG_KEYS), it => it != null),
        matches
    };
}

const CONFIG_KEYS = ['fields', 'groupBy', 'filter', 'sortBy', 'top'];
