import type {PlainObject} from '@xh/hoist/core';
import {lengthIs, numberIs, required, type RuleLike, validEmail} from '@xh/hoist/data';
import {compact, dropRight, isFinite, isPlainObject, isString, uniqBy} from 'lodash';
import {CHAT_UI_MAX_CONTEXT_VALUE_LENGTH} from '../../../../genui';
import type {ChatUiInputRules, ChatUiOption} from '../ChatUiInput';

/**
 * Most characters in the text of an input. A value can go to the model as the context of a
 * message, which holds values no longer than this.
 * @internal
 */
export const MAX_TEXT_LENGTH = CHAT_UI_MAX_CONTEXT_VALUE_LENGTH;

/** Schemas of the props that the built-in inputs share. @internal */
export const NAME_SCHEMA = {
        type: 'string',
        maxLength: 40,
        pattern: '^[A-Za-z][A-Za-z0-9_]*$',
        description:
            'Name of the field, unique in its form, in camelCase. The key of its value in a ' +
            'message the form sends.'
    },
    LABEL_SCHEMA = {type: 'string', maxLength: 80, description: 'Label shown with the input.'},
    PLACEHOLDER_SCHEMA = {
        type: 'string',
        maxLength: 80,
        description: 'Hint shown while the input is empty.'
    };

/**
 * A schema for the `rules` prop of an input, with the rules it takes.
 * @internal
 */
export function rulesSchema(properties: PlainObject): PlainObject {
    return {
        type: 'object',
        additionalProperties: false,
        description: 'Validation rules, as an object, such as {required: true}.',
        properties: {
            required: {type: 'boolean', description: 'True if the user must give a value.'},
            ...properties
        }
    };
}

/** Rules for a text value: required, an email address, and a length. @internal */
export function toTextRules(rules: ChatUiInputRules): RuleLike[] {
    const {minLength, maxLength} = rules,
        max = isFinite(maxLength) ? Math.min(maxLength, MAX_TEXT_LENGTH) : MAX_TEXT_LENGTH;
    return compact([
        rules.required ? required : null,
        rules.email ? validEmail : null,
        lengthIs({min: isFinite(minLength) ? minLength : null, max})
    ]);
}

/** Rules for a number: required, and a range. @internal */
export function toNumberRules(rules: ChatUiInputRules): RuleLike[] {
    const {min, max} = rules;
    return compact([
        rules.required ? required : null,
        isFinite(min) || isFinite(max) ? numberIs({min: min as number, max: max as number}) : null
    ]);
}

/** Rules for a value that is only required or not. @internal */
export function toRequiredRules(rules: ChatUiInputRules): RuleLike[] {
    return rules.required ? [required] : [];
}

/**
 * The options of a select, a segmented control or a radio input, each with a value and a label.
 * Takes a bare value as an option that shows it. While the props stream, the last option may be
 * cut short, so it is left out. An option with no value, or a value already listed, is left out
 * too.
 * @internal
 */
export function toOptions(
    options: (ChatUiOption | string | number)[],
    isPartial: boolean
): {value: string | number; label: string}[] {
    const complete = isPartial ? dropRight(options) : (options ?? []);
    return uniqBy(
        complete.flatMap(it => {
            const option = isPlainObject(it) ? (it as ChatUiOption) : {value: it as string},
                {value, label} = option;
            if (!isString(value) && !isFinite(value)) return [];
            return [{value, label: isString(label) && label ? label : `${value}`}];
        }),
        'value'
    );
}

/** A schema for a list of options, of at most `maxItems`. @internal */
export function optionsSchema(maxItems: number, minItems: number = 1): PlainObject {
    const value = {type: ['string', 'number'], maxLength: MAX_TEXT_LENGTH};
    return {
        type: 'array',
        minItems,
        maxItems,
        description: 'The choices. Each is a value, or an object with a value and a label.',
        items: {
            anyOf: [
                value,
                {
                    type: 'object',
                    required: ['value'],
                    additionalProperties: false,
                    properties: {
                        value: {...value, description: 'What the choice stores.'},
                        label: {type: 'string', maxLength: 80, description: 'What it shows.'}
                    }
                }
            ]
        }
    };
}
