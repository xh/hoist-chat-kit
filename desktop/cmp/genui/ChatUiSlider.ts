import {slider} from '@xh/hoist/desktop/cmp/input';
import {clamp, isArray, isFinite} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import {CHAT_UI_NUMBER_FORMAT_SCHEMA, fmtChatUiNumber} from './ChatUiFormat';
import type {ChatUiInputSpecProps} from './ChatUiInput';
import {chatUiField} from './impl/ChatUiField';
import {LABEL_SCHEMA, NAME_SCHEMA} from './impl/ChatUiInputSupport';
import type {ChatUiNumberFormat, ChatUiSpecOptions} from './Types';

/** Props of the built-in slider, as written by the model. It takes no rules. */
export interface ChatUiSliderSpecProps extends Omit<
    ChatUiInputSpecProps<number | number[]>,
    'rules'
> {
    /** Least value. A number from -1e12 to 1e12. */
    min: number;

    /** Greatest value. A number from -1e12 to 1e12. */
    max: number;

    /** Increment between values. Default 1, or less for a range of 1 or under. */
    step?: number;

    /** How the slider shows its values. Default `number`. */
    format?: ChatUiNumberFormat;

    /** True for two handles. The value is then a list of the low and the high value. */
    range?: boolean;
}

/**
 * A slider for a {@link ChatUiCatalog}: a number in a range, over Hoist's `Slider` in a
 * `FormField`. Its `value` is a state prop: a number, or a list of two with `range`. The slider
 * writes it once the user stops moving a handle for a quarter of a second, so that a drag makes
 * one write. A form sends the value shown at once. It shows the value on each handle, and the
 * least and greatest values under its ends, in a compact form such as `$150M`.
 *
 * A slider always shows a value, so it takes no rules. A value that is missing, not a number or
 * outside the range shows at the nearest end. A range written backwards draws the right way
 * round. Hoist's `Slider` adjusts any other scale it cannot draw.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiSliderSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiSliderSpecProps> {
    const {name = 'slider', description = DESCRIPTION} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['name', 'min', 'max'],
            additionalProperties: false,
            properties: {
                name: NAME_SCHEMA,
                min: {...BOUND_SCHEMA, description: 'Least value.'},
                max: {...BOUND_SCHEMA, description: 'Greatest value.'},
                label: LABEL_SCHEMA,
                step: {
                    type: 'number',
                    description: 'Increment between values. Default 1, or less for a range of 1.'
                },
                format: {
                    ...CHAT_UI_NUMBER_FORMAT_SCHEMA,
                    description: 'How to display the values. "percent" takes a fraction.'
                },
                range: {
                    type: 'boolean',
                    description: 'True for two handles. The value is then [low, high].'
                },
                value: {
                    type: ['number', 'array'],
                    minItems: 2,
                    maxItems: 2,
                    items: {type: 'number'},
                    description:
                        'The number, or [low, high] with range. Bind it to read what the ' +
                        'user sets.'
                }
            }
        },
        stateProps: ['value'],
        standalone: false,
        render: (props, {setProp}) => {
            const {name: field, label, format, range, value} = props,
                {min, max, step} = toScale(props);
            if (!field) return null;
            return chatUiField({
                // A slider of one handle and one of two hold values of different shapes.
                key: range ? 'range' : 'single',
                name: field,
                label,
                value,
                toInput: range
                    ? it => toPair(it, min, max)
                    : it => toNumber(isArray(it) ? it[0] : it, min, max, min),
                fromInput: toJson,
                setProp,
                // A drag, or a run of arrow keys, makes one write: a query that reads the value
                // runs once, not on each step.
                writeDelay: WRITE_DELAY,
                children: slider({
                    // Hoist names the handles by the label of their field. A field with no
                    // label shows none, so its handles take the name of the field.
                    domAttrs: label ? null : {'aria-label': field},
                    min,
                    max,
                    stepSize: step,
                    // A label at each end only. Blueprint draws one per label step.
                    labelStepSize: max - min,
                    // Compact, as $150M, so that a label of a wide range fits the slider.
                    labelRenderer: it =>
                        fmtChatUiNumber(it, format, null, {compact: true, zeroPad: false})
                })
            });
        },
        result: ({label, name: field}) => label ?? field ?? '',
        example: {name: 'risk', min: 0, max: 10, label: 'Risk level', value: 5}
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A slider, with a label. Use it for a number in a known range, such as a level or a ' +
    'share, or with range for a low and a high value.';

const BOUND_SCHEMA = {type: 'number', minimum: -1e12, maximum: 1e12};

// Milliseconds after the last move of a handle before the value goes to the state.
const WRITE_DELAY = 250;

// Significant digits of a value the slider writes. Fewer than a float holds, to drop the noise of
// float sums, such as 0.30000000000000004 for 0.2 + 0.1, at any scale.
const SIGNIFICANT_DIGITS = 15;

// The least, greatest and step values of the slider, whatever the model sent: least value first,
// a greatest value while it still streams, and a step that suits a narrow range. Hoist's Slider
// adjusts a scale it cannot draw, such as a range of no width or a step of zero.
function toScale({min, max, step}: ChatUiSliderSpecProps): {
    min: number;
    max: number;
    step: number;
} {
    let low = isFinite(min) ? min : 0,
        high = isFinite(max) ? max : low + 100;
    if (low > high) [low, high] = [high, low];

    const width = high - low,
        defaultStep = width > 1 || width === 0 ? 1 : 10 ** (Math.floor(Math.log10(width)) - 2);
    return {min: low, max: high, step: isFinite(step) && step > 0 ? step : defaultStep};
}

// The state may hold any value, so show a number within the range only.
function toNumber(value: unknown, min: number, max: number, fallback: number): number {
    return isFinite(value) ? clamp(value as number, min, max) : fallback;
}

function toPair(value: unknown, min: number, max: number): number[] {
    const [a, b] = isArray(value) ? value : [],
        low = toNumber(a, min, max, min),
        high = toNumber(b, min, max, max);
    return low > high ? [high, low] : [low, high];
}

function toJson(value: unknown): unknown {
    return isArray(value) ? value.map(toPrecise) : toPrecise(value as number);
}

function toPrecise(value: number): number {
    return isFinite(value) ? Number(value.toPrecision(SIGNIFICANT_DIGITS)) : value;
}
