import {startCase} from 'lodash';

/** A variable's name for users: its `label`, else its name in words, as `asOf` reads "As Of". */
export function variableLabel(name: string, decl?: {label?: string}): string {
    return decl?.label || startCase(name);
}
