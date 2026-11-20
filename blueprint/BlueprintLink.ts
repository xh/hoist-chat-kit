import {parsePeriod} from '@xh/hoist/cmp/daterange';
import type {PlainObject} from '@xh/hoist/core';
import {isArray, isEqual, isFinite, isPlainObject, isString} from 'lodash';
import type {Blueprint, VariableDecl} from './Blueprint';
import type {BlueprintRegistry} from './BlueprintRegistry';
import {checkVariableValue} from './impl/variableValues';
import {getOwn} from './impl/pointer';
import type {BlueprintOpenOptions} from './repository/BlueprintRepository';
import type {BlueprintDocumentModel} from './repository/BlueprintDocumentModel';
import {isSettableFromOutside} from './validateBlueprint';

/** A link's query params, as the router reads them: each a string, a list of strings, or null. */
export type BlueprintLinkParams = Record<string, unknown>;

/** What a link asks to open, read from its params. See {@link parseBlueprintLink}. */
export interface BlueprintLinkState {
    id: string;
    open: BlueprintOpenOptions;
    /** The preset to choose in each group, by group. */
    presets: Record<string, string>;
    /** Each variable's value, by name, in the form the variable holds it. */
    values: Record<string, unknown>;
    /** Each param the link holds that could not apply, said for the user. */
    problems: string[];
}

/**
 * Params a link reserves. A variable may not take one of these names. `id` is the host route's
 * path param, which the router merges with the query params.
 */
export const BLUEPRINT_LINK_RESERVED = ['id', 'version', 'draft', 'preset'];

/**
 * Read a link to a blueprint from its route's params: which version to open, and, given the
 * blueprint opened, its presets and variable values. Every param is untrusted. A variable that a
 * link may not set, a value that does not fit its variable, and anything past a size cap are
 * dropped, each with a problem, and the rest of the link still applies. Params that name neither
 * a reserved param nor a variable are left to the host.
 *
 * @param params - the route's params, such as `XH.routerState.params`.
 * @param blueprint - the blueprint opened. Without it, only `id` and `open` are read.
 */
export function parseBlueprintLink(
    params: BlueprintLinkParams,
    blueprint: Blueprint = null,
    registry: BlueprintRegistry = null
): BlueprintLinkState {
    const problems: string[] = [],
        ret: BlueprintLinkState = {
            id: isString(params?.id) ? params.id : null,
            open: readOpen(params, problems),
            presets: {},
            values: {},
            problems
        };
    if (!blueprint) return ret;

    readPresets(params.preset, blueprint, ret);
    let size = 0;
    Object.keys(params).forEach(name => {
        const raw = params[name],
            texts = (isArray(raw) ? raw : [raw]).map(it => (it == null ? '' : String(it)));
        size += name.length + texts.reduce((sum, it) => sum + it.length + 1, 0);
        if (BLUEPRINT_LINK_RESERVED.includes(name)) return;
        const decl = getOwn(blueprint.variables, name);
        if (!decl) return;
        if (size > MAX_PARAMS_LENGTH) {
            problems.push(`'${name}' was left out: the link is too long.`);
            return;
        }
        const read = readValue(name, decl, isArray(raw), texts, registry);
        if ('problem' in read) {
            problems.push(read.problem);
        } else {
            ret.values[name] = read.value;
        }
    });
    return ret;
}

/**
 * The params of a link to the blueprint a document model has open, as it is now: its version,
 * where not the latest publish, and the presets and link-settable variables that differ from
 * their defaults. A value with no text form, such as a filter, is left out.
 */
export function blueprintLinkParams(
    doc: BlueprintDocumentModel
): Record<string, string | string[]> {
    const {document, blueprintModel: model} = doc;
    if (!document) return null;
    const ret: Record<string, string | string[]> = {id: document.id};
    if (document.kind === 'draft') {
        ret.draft = '';
    } else if (document.version !== document.publishedVersion) {
        ret.version = String(document.version);
    }

    const presets = Object.entries(model.blueprint?.presets ?? {})
        .filter(([group, def]) => {
            const active = model.getActivePreset(group);
            return active !== (def.default ?? Object.keys(def.items ?? {})[0]);
        })
        .map(([group]) => `${group}:${model.getActivePreset(group)}`);
    if (presets.length) ret.preset = presets;

    model.variables.forEach(v => {
        if (!v.isSettable || isEqual(v.value, v.defaultValue) || v.value == null) return;
        const text = formatValue(v.decl, v.value, model.registry);
        if (text != null) ret[v.name] = text;
    });
    return ret;
}

/** A link's params as a query string, without its leading `?`. A param of `''` is a flag. */
export function toLinkQuery(params: Record<string, string | string[]>): string {
    return Object.entries(params)
        .flatMap(([name, value]) =>
            (isArray(value) ? value : [value]).map(it =>
                it === ''
                    ? encodeURIComponent(name)
                    : `${encodeURIComponent(name)}=${encodeURIComponent(it)}`
            )
        )
        .join('&');
}

//------------------
// Implementation
//------------------
const MAX_VALUE_LENGTH = 1000,
    MAX_LIST_LENGTH = 100,
    MAX_PARAMS_LENGTH = 8000;

function readOpen(params: BlueprintLinkParams, problems: string[]): BlueprintOpenOptions {
    const hasDraft = Object.hasOwn(params ?? {}, 'draft'),
        hasVersion = Object.hasOwn(params ?? {}, 'version');
    if (hasDraft && hasVersion) {
        problems.push('The link names both the draft and a version, so it opens the latest.');
        return {as: 'publish'};
    }
    if (hasDraft) return {as: 'draft'};
    if (hasVersion) {
        const v = params.version;
        if (isString(v) && /^[1-9]\d{0,8}$/.test(v)) return {as: 'publish', version: Number(v)};
        problems.push(`The link's version is not a number, so it opens the latest.`);
    }
    return {as: 'publish'};
}

function readPresets(raw: unknown, blueprint: Blueprint, ret: BlueprintLinkState) {
    if (raw == null) return;
    (isArray(raw) ? raw : [raw]).forEach(it => {
        const text = String(it),
            at = text.indexOf(':'),
            group = at > 0 ? text.slice(0, at) : null,
            item = at > 0 ? text.slice(at + 1) : null,
            def = getOwn(blueprint.presets, group);
        if (def && getOwn(def.items, item)) {
            ret.presets[group] = item;
        } else {
            ret.problems.push(
                `The link's preset '${text.slice(0, 100)}' is not one of this blueprint's.`
            );
        }
    });
}

type Read = {value: unknown} | {problem: string};

function readValue(
    name: string,
    decl: VariableDecl,
    isList: boolean,
    texts: string[],
    registry: BlueprintRegistry
): Read {
    if (!isSettableFromOutside(decl)) return {problem: `A link cannot set '${name}'.`};
    const type = String(decl.type ?? ''),
        listType = type.endsWith('[]'),
        itemType = listType ? type.slice(0, -2) : type;
    if (isList && !listType) return {problem: `'${name}' takes one value.`};
    if (texts.length > MAX_LIST_LENGTH) {
        return {problem: `'${name}' was left out: it lists over ${MAX_LIST_LENGTH} values.`};
    }
    if (texts.some(it => it.length > MAX_VALUE_LENGTH)) {
        return {problem: `'${name}' was left out: its value is too long.`};
    }

    const items: unknown[] = [];
    for (const text of texts) {
        const item = readItem(itemType, text, registry);
        if (item === UNSETTABLE) return {problem: `A link cannot set '${name}'.`};
        if (item === undefined) return {problem: `'${name}' cannot be '${text.slice(0, 100)}'.`};
        items.push(item);
    }
    const value = listType ? items : items[0],
        problem = checkVariableValue(name, decl, value, registry ?? {variableTypes: {}});
    return problem ? {problem: `'${name}' was left out: ${problem}.`} : {value};
}

const UNSETTABLE = Symbol('unsettable');

// One item from its text: the value, undefined if the text does not read, or UNSETTABLE for a
// type with no text form.
function readItem(type: string, text: string, registry: BlueprintRegistry): unknown {
    const appType = getOwn(registry?.variableTypes, type);
    if (appType?.urlCodec) {
        try {
            return appType.urlCodec.parse(text) ?? undefined;
        } catch {
            return undefined;
        }
    }
    const base = appType ? appType.matches : type;
    switch (base) {
        case 'string':
            return text;
        case 'int':
            return /^-?\d{1,15}$/.test(text) ? Number(text) : undefined;
        case 'number':
            return /^-?\d{1,15}(\.\d{1,15})?$/.test(text) ? Number(text) : undefined;
        case 'bool':
            return text === 'true' ? true : text === 'false' ? false : undefined;
        case 'localDate':
            return isIsoDate(text) ? text : undefined;
        case 'date':
            return ISO_INSTANT.test(text) && isFinite(Date.parse(text))
                ? Date.parse(text)
                : undefined;
        case 'period':
            return parsePeriod(text) ? text : undefined;
        case 'dateRange':
            return readDateRange(text, registry);
        default:
            return UNSETTABLE;
    }
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoDate(text: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const d = new Date(`${text}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().startsWith(text);
}

function readDateRange(text: string, registry: BlueprintRegistry): unknown {
    const [start, end, ...rest] = text.split('..');
    if (end != null) {
        return !rest.length && isIsoDate(start) && isIsoDate(end) && start <= end
            ? {kind: 'custom', start, end}
            : undefined;
    }
    return getOwn(registry?.dateRangePresets, text) ? text : undefined;
}

// A value in its link form, or null for one with none.
function formatValue(
    decl: VariableDecl,
    value: unknown,
    registry: BlueprintRegistry
): string | string[] {
    const type = String(decl.type ?? ''),
        listType = type.endsWith('[]'),
        itemType = listType ? type.slice(0, -2) : type,
        items = (listType ? value : [value]) as unknown[],
        texts = items.map(it => formatItem(itemType, it, registry));
    if (texts.some(it => it == null)) return null;
    return listType ? texts : texts[0];
}

function formatItem(type: string, value: unknown, registry: BlueprintRegistry): string {
    const appType = getOwn(registry?.variableTypes, type);
    if (appType?.urlCodec) return appType.urlCodec.format(value);
    switch (appType ? appType.matches : type) {
        case 'string':
        case 'localDate':
        case 'period':
        case 'int':
        case 'number':
        case 'bool':
            return String(value);
        case 'date':
            return new Date(value as number).toISOString();
        case 'dateRange': {
            if (isString(value)) return value;
            const v = value as PlainObject;
            return isPlainObject(v) && v.kind === 'custom' ? `${v.start}..${v.end}` : null;
        }
        default:
            return null;
    }
}
