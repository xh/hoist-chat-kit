import {numberInput} from '@xh/hoist/desktop/cmp/input';
import {isFinite} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiInputSpecProps} from './ChatUiInput';
import {chatUiField} from './impl/ChatUiField';
import {
    LABEL_SCHEMA,
    NAME_SCHEMA,
    PLACEHOLDER_SCHEMA,
    rulesSchema,
    toNumberRules
} from './impl/ChatUiInputSupport';
import type {ChatUiSpecOptions} from './Types';

/** Props of the built-in number input, as written by the model. */
export interface ChatUiNumberInputSpecProps extends ChatUiInputSpecProps<number> {
    /** Hint shown while the input is empty. */
    placeholder?: string;
}

/**
 * A number input for a {@link ChatUiCatalog}, over Hoist's `NumberInput` in a `FormField`. Its
 * `value` is a state prop, written when the user leaves the input or presses Enter. The rules
 * `required`, `min` and `max` run as Hoist rules. The input shows thousands separators, and
 * takes shorthand such as `2.5k`.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiNumberInputSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiNumberInputSpecProps> {
    const {name = 'numberInput', description = DESCRIPTION} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['name'],
            additionalProperties: false,
            properties: {
                name: NAME_SCHEMA,
                label: LABEL_SCHEMA,
                placeholder: PLACEHOLDER_SCHEMA,
                rules: rulesSchema({
                    min: {type: 'number', description: 'Least value.'},
                    max: {type: 'number', description: 'Greatest value.'}
                }),
                value: {
                    type: 'number',
                    description: 'The number. Bind it to read what the user enters.'
                }
            }
        },
        stateProps: ['value'],
        standalone: false,
        render: ({name: field, label, placeholder, rules, value}, {setProp}) =>
            field
                ? chatUiField({
                      name: field,
                      label,
                      rules,
                      toRules: toNumberRules,
                      value,
                      toInput: toNumber,
                      setProp,
                      children: numberInput({
                          placeholder,
                          displayWithCommas: true,
                          enableShorthandUnits: true
                      })
                  })
                : null,
        result: ({label, name: field}) => label ?? field ?? '',
        example: {name: 'quantity', label: 'Quantity', rules: {required: true, min: 1, max: 1000}}
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A number input, with a label. Use it to ask the user for an amount, a count or a limit.';

// The state may hold any value, so show a number only.
function toNumber(value: unknown): number {
    return isFinite(value) ? (value as number) : null;
}
