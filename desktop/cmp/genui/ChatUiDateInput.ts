import {dateIs, required, type RuleLike} from '@xh/hoist/data';
import {dateInput} from '@xh/hoist/desktop/cmp/input';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {compact, isString} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiInputRules, ChatUiInputSpecProps} from './ChatUiInput';
import {chatUiField} from './impl/ChatUiField';
import {LABEL_SCHEMA, NAME_SCHEMA, rulesSchema} from './impl/ChatUiInputSupport';
import type {ChatUiSpecOptions} from './Types';

/** Props of the built-in date input, as written by the model. A date is `YYYY-MM-DD`. */
export type ChatUiDateInputSpecProps = ChatUiInputSpecProps<string>;

/**
 * A date input for a {@link ChatUiCatalog}: a day, typed or picked from a calendar, over Hoist's
 * `DateInput` in a `FormField`. Its `value` is a state prop, a date as `YYYY-MM-DD`. The input
 * holds a Hoist `LocalDate`, so the day does not shift with the time zone. The rules `required`,
 * `min` and `max` run as Hoist rules, and `min` and `max` also bound the calendar.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiDateInputSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiDateInputSpecProps> {
    const {name = 'dateInput', description = DESCRIPTION} = opts;

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
                rules: rulesSchema({
                    min: {...DATE_SCHEMA, description: 'Earliest day, as YYYY-MM-DD.'},
                    max: {...DATE_SCHEMA, description: 'Latest day, as YYYY-MM-DD.'}
                }),
                value: {
                    ...DATE_SCHEMA,
                    description: 'The day, as YYYY-MM-DD. Bind it to read what the user picks.'
                }
            }
        },
        stateProps: ['value'],
        standalone: false,
        render: ({name: field, label, rules, value}, {setProp}) =>
            field
                ? chatUiField({
                      name: field,
                      label,
                      rules,
                      toRules: toDateRules,
                      value,
                      toInput: toLocalDate,
                      fromInput: toIsoString,
                      setProp,
                      children: dateInput({
                          valueType: 'localDate',
                          minDate: toLocalDate(rules?.min),
                          maxDate: toLocalDate(rules?.max),
                          enableClear: !rules?.required
                      })
                  })
                : null,
        result: ({label, name: field}) => label ?? field ?? '',
        example: {name: 'startDate', label: 'Start date', rules: {required: true}}
    };
}

//------------------
// Implementation
//------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/,
    DATE_SCHEMA = {type: 'string', maxLength: 10, pattern: '^\\d{4}-\\d{2}-\\d{2}$'};

const DESCRIPTION =
    'A date input with a calendar, and a label. Use it to ask the user for a day. Dates are ' +
    'YYYY-MM-DD.';

// The state may hold any value, so take a real `YYYY-MM-DD` day only.
function toLocalDate(value: unknown): LocalDate {
    if (!isString(value) || !DATE_RE.test(value)) return null;
    try {
        return LocalDate.get(value);
    } catch {
        return null;
    }
}

function toIsoString(value: unknown): string {
    return LocalDate.isLocalDate(value) ? (value as LocalDate).isoString : null;
}

function toDateRules(rules: ChatUiInputRules): RuleLike[] {
    const min = toLocalDate(rules.min),
        max = toLocalDate(rules.max);
    return compact([rules.required ? required : null, min || max ? dateIs({min, max}) : null]);
}
