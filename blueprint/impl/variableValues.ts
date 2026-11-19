import {isArray, isBoolean, isEqual, isFinite, isInteger, isString} from 'lodash';
import type {VariableDecl} from '../Blueprint';
import type {BlueprintRegistry} from '../BlueprintRegistry';
import {checkFilter} from './configSchema';

/**
 * Why a value cannot be a variable's, or null if it can. Null always can, as no value. Checks the
 * variable's type, each item of a list type, and its `options.values`. An app type checks as the
 * field type it matches.
 */
export function checkVariableValue(
    name: string,
    decl: VariableDecl,
    value: unknown,
    registry: Pick<BlueprintRegistry, 'variableTypes'>
): string {
    if (value == null) return null;
    const type = String(decl.type ?? ''),
        isList = type.endsWith('[]'),
        itemType = isList ? type.slice(0, -2) : type,
        items = isList ? value : [value];
    if (isList && !isArray(value)) return `'${name}' takes a list of ${itemType}`;

    const base = registry.variableTypes[itemType]?.matches ?? itemType;
    for (const item of items as unknown[]) {
        if (!matchesType(item, base))
            return `'${name}' takes a ${type}, not ${JSON.stringify(item)}`;
        const options = (decl.options as any)?.values;
        if (isArray(options) && !options.some(it => isEqual(it, item))) {
            return `'${name}' takes one of ${options.join(', ')}, not ${JSON.stringify(item)}`;
        }
    }
    return null;
}

//------------------
// Implementation
//------------------
function matchesType(value: unknown, type: string): boolean {
    switch (type) {
        case 'string':
            return isString(value);
        case 'number':
            return isFinite(value);
        case 'int':
            return isInteger(value);
        case 'bool':
            return isBoolean(value);
        case 'localDate':
            return isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
        case 'date':
            return isFinite(value);
        case 'filter':
            return checkFilter(value).length === 0;
        default:
            // An app type that matches no field type, such as a portfolio, takes any JSON value.
            return true;
    }
}
