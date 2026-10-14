import type {PlainObject} from '@xh/hoist/core';
import {compact, isEmpty, isPlainObject, isString} from 'lodash';
import type {ChatMessage} from '../../core';
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

/**
 * The structured context of a user message - such as the record a generative UI button acted on -
 * or null. A `send` action records it as `metadata.context`.
 * @internal
 */
export function messageContext(message: ChatMessage): PlainObject {
    const context = message?.metadata.context;
    return isPlainObject(context) && !isEmpty(context) ? context : null;
}

/**
 * The structured context of a user message as a block to add to its text, or null if it has
 * none - for codecs whose format has no place for it.
 * @internal
 */
export function messageContextText(message: ChatMessage): string {
    const context = messageContext(message);
    return context ? `<message-context>\n${JSON.stringify(context)}\n</message-context>` : null;
}
