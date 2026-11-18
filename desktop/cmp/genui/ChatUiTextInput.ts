import {textInput} from '@xh/hoist/desktop/cmp/input';
import {isString} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiInputSpecProps} from './ChatUiInput';
import {chatUiField} from './impl/ChatUiField';
import {
    LABEL_SCHEMA,
    MAX_TEXT_LENGTH,
    NAME_SCHEMA,
    PLACEHOLDER_SCHEMA,
    rulesSchema,
    toTextRules
} from './impl/ChatUiInputSupport';
import type {ChatUiSpecOptions} from './Types';

/** Props of the built-in text input, as written by the model. */
export interface ChatUiTextInputSpecProps extends ChatUiInputSpecProps<string> {
    /** Hint shown while the input is empty. */
    placeholder?: string;
}

/**
 * A text input for a {@link ChatUiCatalog}: one line of text, over Hoist's `TextInput` in a
 * `FormField`. Its `value` is a state prop. The user's text goes to the state when they leave the
 * input or press Enter, as Hoist commits it. The rules `required`, `email`, `minLength` and
 * `maxLength` run as Hoist rules, and show their messages under the input.
 *
 * Text is at most 100 characters, the most a `send` action carries per value.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiTextInputSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiTextInputSpecProps> {
    const {name = 'textInput', description = DESCRIPTION} = opts;

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
                    email: {type: 'boolean', description: 'True for an email address.'},
                    minLength: {type: 'integer', minimum: 0, maximum: MAX_TEXT_LENGTH},
                    maxLength: {type: 'integer', minimum: 1, maximum: MAX_TEXT_LENGTH}
                }),
                value: {
                    type: 'string',
                    maxLength: MAX_TEXT_LENGTH,
                    description: 'The text. Bind it to read what the user types.'
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
                      toRules: toTextRules,
                      value,
                      toInput: toText,
                      setProp,
                      children: textInput({placeholder})
                  })
                : null,
        result: ({label, name: field}) => label ?? field ?? '',
        example: {
            name: 'email',
            label: 'Email',
            placeholder: 'you@example.com',
            rules: {required: true, email: true}
        }
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A one-line text input, with a label. Use it to ask the user for a short text value, such ' +
    'as a name or an email address.';

// The state may hold any value, so show text only.
function toText(value: unknown): string {
    return isString(value) ? value : value == null ? null : `${value}`;
}
