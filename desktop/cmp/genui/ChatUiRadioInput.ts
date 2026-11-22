import {radioInput} from '@xh/hoist/desktop/cmp/input';
import {uniqBy} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiInputSpecProps, ChatUiOption} from './ChatUiInput';
import {chatUiField} from './impl/ChatUiField';
import {
    LABEL_SCHEMA,
    MAX_TEXT_LENGTH,
    NAME_SCHEMA,
    optionsSchema,
    rulesSchema,
    toOptions,
    toRequiredRules
} from './impl/ChatUiInputSupport';
import type {ChatUiSpecOptions} from './Types';

/** Props of the built-in radio input, as written by the model. */
export interface ChatUiRadioInputSpecProps extends ChatUiInputSpecProps<string | number> {
    /** The choices. Each is a value, or a value with a label. */
    options: (ChatUiOption | string | number)[];
}

/** Options for {@link chatUiRadioInputSpec}. */
export interface ChatUiRadioInputSpecOptions extends ChatUiSpecOptions {
    /** Most choices the model may send. Default 8. */
    maxOptions?: number;
}

/**
 * A radio input for a {@link ChatUiCatalog}: a list of choices with one selected, over Hoist's
 * `RadioInput` in a `FormField`. Its `value` is a state prop, written on each click. The rule
 * `required` runs as a Hoist rule. A value that is not among the choices shows none selected.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiRadioInputSpec(
    opts: ChatUiRadioInputSpecOptions = {}
): ChatUiComponentSpec<ChatUiRadioInputSpecProps> {
    const {name = 'radioInput', description = DESCRIPTION, maxOptions = 8} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['name', 'options'],
            additionalProperties: false,
            properties: {
                name: NAME_SCHEMA,
                options: optionsSchema(maxOptions, 2),
                label: LABEL_SCHEMA,
                rules: rulesSchema({}),
                value: {
                    type: ['string', 'number'],
                    maxLength: MAX_TEXT_LENGTH,
                    description: 'The selected value. Bind it to read what the user picks.'
                }
            }
        },
        stateProps: ['value'],
        standalone: false,
        render: (props, {setProp, isPartial}) => {
            const {name: field, label, rules, value} = props,
                // A radio button holds its value as text, so each choice has one text key.
                options = uniqBy(toOptions(props.options, isPartial), it => `${it.value}`);
            if (!field) return null;
            return chatUiField({
                name: field,
                label,
                rules,
                toRules: toRequiredRules,
                value,
                toInput: it => (options.some(option => option.value === it) ? `${it}` : null),
                fromInput: it => options.find(option => `${option.value}` === it)?.value ?? null,
                setProp,
                children: radioInput({
                    options: options.map(it => ({value: `${it.value}`, label: it.label}))
                })
            });
        },
        result: ({label, name: field}) => label ?? field ?? '',
        example: {
            name: 'plan',
            options: [
                {value: 'basic', label: 'Basic'},
                {value: 'pro', label: 'Pro'}
            ],
            label: 'Plan',
            value: 'basic'
        }
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A list of choices with one selected, and a label. Use it in place of a dropdown to show ' +
    'every choice at once, for two to eight choices.';
