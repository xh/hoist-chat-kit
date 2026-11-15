import {slider} from '@xh/hoist/desktop/cmp/input';
import {clamp, isArray, isFinite, round} from 'lodash';
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

    /**
     * Increment between values. Default 1, or less for a range of 1 or under. A range holds at
     * most 100,000 steps, so a smaller step becomes that share of the range.
     */
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
 * least and greatest values under its ends.
 *
 * A slider always shows a value, so it takes no rules. A value that is missing, not a number or
 * outside the range shows at the nearest end. The slider bounds the scale it draws: a range too
 * narrow to draw becomes a range of 1, and a range holds at most 100,000 steps.
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
                {min, max, step} = toScale(props),
                handleName = label || field;
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
                item: slider({
                    // Hoist names a handle by the label of its field. A field with no label
                    // has none, and the two handles of a range need a name each.
                    ariaLabel: range
                        ? [`${handleName}, low`, `${handleName}, high`]
                        : label
                          ? null
                          : handleName,
                    min,
                    max,
                    stepSize: step,
                    // A label at each end only. Blueprint draws one per label step.
                    labelStepSize: max - min,
                    // Compact, as $150m, so that a label of a wide range fits the slider.
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

// Most decimal places of a value the slider writes, to drop the noise of float steps.
const MAX_DECIMALS = 10;

// The bounds of a scale that Blueprint's slider can draw. Outside them it loops for a long time
// or for ever: it counts the decimal places of the step, and it writes a label per label step up
// to a fixed distance past the greatest value.
const MAX_MAGNITUDE = 1e12,
    // The least width of a range, and the least share of its magnitude, so that a sum of the
    // least value and the width is a new number.
    MIN_WIDTH = 1e-4,
    MIN_RELATIVE_WIDTH = 1e-6,
    // Most steps in a range, which bounds the least step.
    MAX_STEPS = 100_000,
    // Significant digits of a step. A short decimal has decimal places that Blueprint can count.
    STEP_DIGITS = 6;

// The least, greatest and step values of a slider that Hoist can draw, whatever the model sent:
// numbers of a bounded size, least value first, a range wide enough to draw, and a step that is
// a short decimal, above zero and within the range. A range too narrow to draw, such as one of no
// width, becomes a range of at least 1.
function toScale({min, max, step}: ChatUiSliderSpecProps): {
    min: number;
    max: number;
    step: number;
} {
    const bound = (it: number) => clamp(it, -MAX_MAGNITUDE, MAX_MAGNITUDE);
    let low = isFinite(min) ? bound(min) : 0,
        high = isFinite(max) ? bound(max) : low + 100;
    if (low > high) [low, high] = [high, low];

    const magnitude = Math.max(Math.abs(low), Math.abs(high)),
        minWidth = Math.max(MIN_WIDTH, magnitude * MIN_RELATIVE_WIDTH);
    if (high - low < minWidth) high = low + Math.max(1, minWidth);

    const width = high - low,
        defaultStep = width > 1 ? 1 : 10 ** (Math.floor(Math.log10(width)) - 2),
        wanted = isFinite(step) && step > 0 ? step : defaultStep,
        short = (it: number) => Number(it.toPrecision(STEP_DIGITS)),
        bounded = short(clamp(wanted, width / MAX_STEPS, width));
    // A step that rounds to more than the width is half the width.
    return {min: low, max: high, step: bounded <= width ? bounded : short(width / 2)};
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
    return isArray(value)
        ? value.map(it => round(it, MAX_DECIMALS))
        : round(value as number, MAX_DECIMALS);
}
