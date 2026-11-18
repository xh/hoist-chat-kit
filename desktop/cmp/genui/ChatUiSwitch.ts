import {switchInput} from '@xh/hoist/desktop/cmp/input';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiInputSpecProps} from './ChatUiInput';
import {chatUiField} from './impl/ChatUiField';
import {LABEL_SCHEMA, NAME_SCHEMA} from './impl/ChatUiInputSupport';
import type {ChatUiSpecOptions} from './Types';

/** Props of the built-in switch, as written by the model. It takes no rules. */
export type ChatUiSwitchSpecProps = Omit<ChatUiInputSpecProps<boolean>, 'rules'>;

/**
 * A switch for a {@link ChatUiCatalog}: an on or off, over Hoist's `SwitchInput` in a
 * `FormField`. Its `value` is a state prop, true or false, written on each click. The label
 * shows beside the switch.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiSwitchSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiSwitchSpecProps> {
    const {name = 'switch', description = DESCRIPTION} = opts;

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
                    description: 'True if on. Bind it to read what the user sets.'
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
                      children: switchInput({label})
                  })
                : null,
        result: ({label, name: field}) => label ?? field ?? '',
        example: {name: 'live', label: 'Live prices', value: false}
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A switch, with a label beside it. Use it for a setting that is on or off, and that ' +
    'changes what the answer shows.';

// The state may hold any value, so show a boolean only.
function toBoolean(value: unknown): boolean {
    return value === true;
}
