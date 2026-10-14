import {compact, isString} from 'lodash';
import type {ChatRunContext} from '../ChatTransport';

/**
 * A piece of live context as a section of a system prompt, in a tag that names its provider.
 * @internal
 */
export function contextText({name, description, value}: ChatRunContext): string {
    return compact([
        `<context name="${name}">`,
        description,
        contextValueText(value),
        '</context>'
    ]).join('\n');
}

/**
 * A context value as text - as is if a string, else as JSON.
 * @internal
 */
export function contextValueText(value: ChatRunContext['value']): string {
    return isString(value) ? value : JSON.stringify(value);
}
