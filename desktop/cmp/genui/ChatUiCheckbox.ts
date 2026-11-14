import {checkbox} from '@xh/hoist/desktop/cmp/input';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiInputSpecProps} from './ChatUiInput';
import {chatUiField} from './impl/ChatUiField';
import {LABEL_SCHEMA, NAME_SCHEMA} from './impl/ChatUiInputSupport';
import type {ChatUiSpecOptions} from './Types';

/** Props of the built-in checkbox, as written by the model. It takes no rules. */
export type ChatUiCheckboxSpecProps = Omit<ChatUiInputSpecProps<boolean>, 'rules'>;

/**
 * A checkbox for a {@link ChatUiCatalog}: a yes or no, over Hoist's `Checkbox` in a `FormField`.
 * Its `value` is a state prop, true or false, written on each click. The label shows beside the
 * box.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiCheckboxSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiCheckboxSpecProps> {
    const {name = 'checkbox', description = DESCRIPTION} = opts;

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
                value: {
                    type: 'boolean',
                    description: 'True if checked. Bind it to read what the user sets.'
                }
            }
        },
        stateProps: ['value'],
        standalone: false,
        render: ({name: field, label, value}, {setProp}) =>
            field
                ? chatUiField({
                      name: field,
                      label,
                      hideLabel: true,
                      value,
                      toInput: toBoolean,
                      setProp,
                      item: checkbox({label})
                  })
                : null,
        result: ({label, name: field}) => label ?? field ?? '',
        example: {name: 'subscribe', label: 'Send me updates', value: true}
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A checkbox, with a label beside it. Use it for a yes or no, such as an option the user ' +
    'turns on.';

// The state may hold any value, so show a boolean only.
function toBoolean(value: unknown): boolean {
    return value === true;
}
