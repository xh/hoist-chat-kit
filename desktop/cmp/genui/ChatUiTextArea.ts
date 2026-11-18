import {textArea} from '@xh/hoist/desktop/cmp/input';
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

/** Props of the built-in text area, as written by the model. */
export interface ChatUiTextAreaSpecProps extends ChatUiInputSpecProps<string> {
    /** Hint shown while the input is empty. */
    placeholder?: string;
}

/**
 * A text area for a {@link ChatUiCatalog}: a few lines of text, over Hoist's `TextArea` in a
 * `FormField`. Its `value` is a state prop, written when the user leaves the input. The rules
 * `required`, `minLength` and `maxLength` run as Hoist rules.
 *
 * Text is at most 100 characters, the most a `send` action carries per value. A longer note
 * belongs in the user's own message.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiTextAreaSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiTextAreaSpecProps> {
    const {name = 'textArea', description = DESCRIPTION} = opts;

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
                      children: textArea({placeholder, height: 72})
                  })
                : null,
        result: ({label, name: field}) => label ?? field ?? '',
        example: {name: 'note', label: 'Note', placeholder: 'Anything we should know?'}
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    `A text input of a few lines, with a label, for a short note of at most ${MAX_TEXT_LENGTH} ` +
    'characters.';

// The state may hold any value, so show text only.
function toText(value: unknown): string {
    return isString(value) ? value : value == null ? null : `${value}`;
}
