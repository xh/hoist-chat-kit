import {select} from '@xh/hoist/desktop/cmp/input';
import {castArray, isArray, isEmpty} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiInputSpecProps, ChatUiOption} from './ChatUiInput';
import {chatUiField} from './impl/ChatUiField';
import {
    LABEL_SCHEMA,
    MAX_TEXT_LENGTH,
    NAME_SCHEMA,
    optionsSchema,
    PLACEHOLDER_SCHEMA,
    rulesSchema,
    toOptions,
    toRequiredRules
} from './impl/ChatUiInputSupport';
import type {ChatUiSpecOptions} from './Types';

/** Props of the built-in select, as written by the model. */
export interface ChatUiSelectSpecProps extends ChatUiInputSpecProps<
    string | number | (string | number)[]
> {
    /** The choices. Each is a value, or a value with a label. */
    options: (ChatUiOption | string | number)[];

    /** Hint shown while nothing is selected. */
    placeholder?: string;

    /** True to let the user select several choices. The value is then a list. Default false. */
    multi?: boolean;
}

/** Options for {@link chatUiSelectSpec}. */
export interface ChatUiSelectSpecOptions extends ChatUiSpecOptions {
    /** Most choices the model may send. Default 50. */
    maxOptions?: number;
}

/**
 * A select for a {@link ChatUiCatalog}: a dropdown of choices, over Hoist's `Select` in a
 * `FormField`. Its `value` is a state prop: one value, or a list with `multi`. A choice writes it
 * at once. The rule `required` runs as a Hoist rule. A select of more than 8 choices filters as
 * the user types.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiSelectSpec(
    opts: ChatUiSelectSpecOptions = {}
): ChatUiComponentSpec<ChatUiSelectSpecProps> {
    const {name = 'select', description = DESCRIPTION, maxOptions = 50} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['name', 'options'],
            additionalProperties: false,
            properties: {
                name: NAME_SCHEMA,
                options: optionsSchema(maxOptions),
                label: LABEL_SCHEMA,
                placeholder: PLACEHOLDER_SCHEMA,
                multi: {
                    type: 'boolean',
                    description: 'True to select several. The value is then a list.'
                },
                rules: rulesSchema({}),
                value: {
                    type: ['string', 'number', 'array'],
                    maxLength: MAX_TEXT_LENGTH,
                    maxItems: maxOptions,
                    items: {type: ['string', 'number'], maxLength: MAX_TEXT_LENGTH},
                    description:
                        'The selected value, or a list of them with multi. Bind it to read ' +
                        'what the user selects.'
                }
            }
        },
        stateProps: ['value'],
        standalone: false,
        render: (props, {setProp, isPartial}) => {
            const {name: field, label, placeholder, multi, rules, value} = props,
                options = toOptions(props.options, isPartial);
            if (!field) return null;
            return chatUiField({
                name: field,
                label,
                rules,
                toRules: toRequiredRules,
                value,
                toInput: multi ? toList : toOne,
                fromInput: multi ? fromList : null,
                setProp,
                item: select({
                    options,
                    placeholder,
                    enableMulti: !!multi,
                    enableClear: !rules?.required,
                    enableFilter: options.length > FILTER_ABOVE
                })
            });
        },
        result: ({label, name: field}) => label ?? field ?? '',
        example: {
            name: 'region',
            options: [
                {value: 'emea', label: 'EMEA'},
                {value: 'apac', label: 'APAC'}
            ],
            label: 'Region',
            value: 'emea'
        }
    };
}

//------------------
// Implementation
//------------------
const FILTER_ABOVE = 8;

const DESCRIPTION =
    'A dropdown of choices, with a label. Use it for one choice among several, or with multi ' +
    'for any number of them.';

// The state may hold any value, so take a list for a single select by its first item.
function toOne(value: unknown): unknown {
    return isArray(value) ? (value[0] ?? null) : value;
}

function toList(value: unknown): unknown[] {
    return value == null ? [] : castArray(value);
}

// An empty selection is no value.
function fromList(value: unknown): unknown {
    return isEmpty(value) ? null : value;
}
