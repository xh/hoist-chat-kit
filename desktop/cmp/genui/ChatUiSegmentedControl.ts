import {segmentedControl} from '@xh/hoist/desktop/cmp/input';
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

/** Props of the built-in segmented control, as written by the model. */
export interface ChatUiSegmentedControlSpecProps extends ChatUiInputSpecProps<string | number> {
    /** The choices. Each is a value, or a value with a label. */
    options: (ChatUiOption | string | number)[];
}

/** Options for {@link chatUiSegmentedControlSpec}. */
export interface ChatUiSegmentedControlSpecOptions extends ChatUiSpecOptions {
    /** Most choices the model may send. Default 6. */
    maxOptions?: number;
}

/**
 * A segmented control for a {@link ChatUiCatalog}: a row of choices with one selected, over
 * Hoist's `SegmentedControl` in a `FormField`. Its `value` is a state prop, written on each
 * click. The rule `required` runs as a Hoist rule. Options that do not fit on one row wrap.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiSegmentedControlSpec(
    opts: ChatUiSegmentedControlSpecOptions = {}
): ChatUiComponentSpec<ChatUiSegmentedControlSpecProps> {
    const {name = 'segmentedControl', description = DESCRIPTION, maxOptions = 6} = opts;

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
                options = toOptions(props.options, isPartial);
            if (!field) return null;
            return chatUiField({
                name: field,
                label,
                rules,
                toRules: toRequiredRules,
                value,
                setProp,
                item: segmentedControl({options, fill: false, wrap: true})
            });
        },
        result: ({label, name: field}) => label ?? field ?? '',
        example: {
            name: 'period',
            options: [
                {value: 'day', label: 'Day'},
                {value: 'week', label: 'Week'},
                {value: 'month', label: 'Month'}
            ],
            label: 'Period',
            value: 'week'
        }
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A row of a few choices with one selected, and a label. Use it in place of a dropdown for ' +
    'two to six short choices, such as a period or a view.';
