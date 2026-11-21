import {getOwn} from './pointer';

// Plain data and pure functions only, so the validator loads under plain Node.

/**
 * Params a link reserves. A variable may not take one of these names. `id` is the host route's
 * path param, which the router merges with the query params.
 */
export const BLUEPRINT_LINK_RESERVED = ['id', 'version', 'draft', 'preset'];

const LINK_TYPES = ['string', 'localDate', 'period', 'int', 'number', 'bool', 'date', 'dateRange'];

/** True for a variable type a link can set: one with a text form, or an app type's `urlCodec`. */
export function isLinkSettableType(
    type: string,
    registry: {variableTypes: Record<string, {matches: string; urlCodec?: unknown}>}
): boolean {
    const base = String(type ?? '').replace(/\[\]$/, ''),
        appType = getOwn(registry?.variableTypes, base);
    return !!appType?.urlCodec || LINK_TYPES.includes(appType ? appType.matches : base);
}
