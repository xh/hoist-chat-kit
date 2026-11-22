import {vbox} from '@xh/hoist/cmp/layout';
import {progressBar} from '@xh/hoist/cmp/progressbar';
import {dropRight, isEmpty, isFinite, isPlainObject, isString} from 'lodash';
import type {ReactNode} from 'react';
import type {ChatUiComponentSpec} from '../../../genui';
import {CHAT_UI_NUMBER_FORMAT_SCHEMA, fmtChatUiNumber} from './ChatUiFormat';
import {CHAT_UI_INTENTS, toHoistIntent} from './impl/ChatUiIntents';
import {takeItems, withMoreNote} from './impl/ChatUiMore';
import type {ChatUiIntent, ChatUiNumberFormat, ChatUiSpecOptions} from './Types';
import './ChatUiProgressBars.scss';

/** One bar of a progress bars component, as written by the model. It shows as a `ProgressBar`. */
export interface ChatUiProgressBar {
    /** What the bar measures, shown over it. */
    label: string;

    /** The value, from 0 to `max`. A value outside that range shows an empty or a full bar. */
    value: number;

    /** Value of a full bar. Default 100, or 1 with the `percent` format. */
    max?: number;

    /**
     * How the figure over the bar shows the value and `max`, such as `$7,200 of $10,000`. With
     * `percent`, the figure is the share of `max`, such as `24.9%`. With none, it is the whole
     * percent of `max`.
     */
    format?: ChatUiNumberFormat;

    /** Color of the fill - for example `danger` for a limit that is close. Default `primary`. */
    intent?: ChatUiIntent;

    /** Value to mark on the bar with a line, for a goal or a threshold. */
    target?: number;
}

/** Props of a progress bars component, as written by the model. */
export interface ChatUiProgressBarsSpecProps {
    /** The bars, in display order. */
    bars: ChatUiProgressBar[];
}

/** Options for {@link chatUiProgressBarsSpec}. */
export interface ChatUiProgressBarsSpecOptions extends ChatUiSpecOptions {
    /** Most bars to show. The rest show as a count. Default 12. */
    maxItems?: number;
}

/**
 * A progress bars component for a {@link ChatUiCatalog}: a column of bars, each a value against a
 * maximum, such as usage against a limit or the progress of a task. It renders a Hoist
 * `ProgressBar` per bar, and formats the figure over each. While the props stream, only complete
 * bars show.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiProgressBarsSpec(
    opts: ChatUiProgressBarsSpecOptions = {}
): ChatUiComponentSpec<ChatUiProgressBarsSpecProps> {
    const {name = 'progressBars', description = DESCRIPTION, maxItems = 12} = opts;

    return {
        name,
        kitComponent: 'progressBars',
        description,
        props: {
            type: 'object',
            required: ['bars'],
            additionalProperties: false,
            properties: {
                bars: {
                    type: 'array',
                    minItems: 1,
                    description: `At most ${maxItems}.`,
                    items: {
                        type: 'object',
                        required: ['label', 'value'],
                        additionalProperties: false,
                        properties: {
                            label: {type: 'string', minLength: 1, maxLength: 60},
                            value: {type: 'number', description: 'The value, from 0 to max.'},
                            max: {
                                type: 'number',
                                description:
                                    'Value of a full bar. Default 100, or 1 with "percent".'
                            },
                            format: {
                                ...CHAT_UI_NUMBER_FORMAT_SCHEMA,
                                description:
                                    'Shows the value and max in this format, as "$7,200 of ' +
                                    '$10,000". "percent" shows the share of max. Default the ' +
                                    'whole percent of max.'
                            },
                            intent: {
                                enum: CHAT_UI_INTENTS,
                                description: 'Color of the fill. Default "primary".'
                            },
                            target: {
                                type: 'number',
                                description: 'Value to mark with a line, for a goal.'
                            }
                        }
                    }
                }
            }
        },
        standalone: false,
        render: ({bars}, {isPartial}) => {
            // While streaming, the last bar may be cut short - its value still being written.
            const complete = (isPartial ? dropRight(bars) : (bars ?? [])).filter(isBar),
                {shown, hidden} = takeItems(complete, maxItems);
            if (isEmpty(shown)) return null;
            return withMoreNote(
                vbox({
                    className: 'xh-chat-ui-progress-bars',
                    children: shown.map((bar, idx) => {
                        const max = toMax(bar);
                        return progressBar({
                            key: idx,
                            label: bar.label,
                            value: bar.value,
                            max,
                            valueRenderer: toValueRenderer(bar.format, max),
                            intent: toHoistIntent(bar.intent),
                            target: isFinite(bar.target) ? bar.target : null
                        });
                    })
                }),
                hidden
            );
        },
        result: ({bars}) => bars.map(it => it.label).join(', '),
        example: {
            bars: [
                {label: 'Storage', value: 72},
                {label: 'Budget', value: 7200, max: 10000, format: 'currency', intent: 'warning'}
            ]
        }
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A column of progress bars, each a label and a value against a maximum. Use it for usage ' +
    'against a limit, or for the progress of a task or a goal.';

const FORMATS: ChatUiNumberFormat[] = ['number', 'percent', 'currency', 'none'];

// A bar with no number has no place on its track, and Hoist would draw it empty.
function isBar(bar: unknown): bar is ChatUiProgressBar {
    if (!isPlainObject(bar)) return false;
    const {label, value} = bar as ChatUiProgressBar;
    return isString(label) && !isEmpty(label) && isFinite(value);
}

// A full bar is above zero. A fraction, as the percent format takes it, is full at 1.
function toMax({max, format}: ChatUiProgressBar): number {
    return isFinite(max) && max > 0 ? max : format === 'percent' ? 1 : 100;
}

// The figure over the bar. With no format, null leaves Hoist's default: the value as a whole
// percent of `max`. With `percent`, one figure: the share of `max`. A model may write a fraction
// with no `max`, or a raw value with its `max`, and both read the same.
function toValueRenderer(format: ChatUiNumberFormat, max: number): (value: number) => ReactNode {
    if (!FORMATS.includes(format)) return null;
    const fmt = (it: number) => fmtChatUiNumber(it, format, null, {compact: true, zeroPad: false});
    return value => (format === 'percent' ? `${fmt(value / max)}` : `${fmt(value)} of ${fmt(max)}`);
}
