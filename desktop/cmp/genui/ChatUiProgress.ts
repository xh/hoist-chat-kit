import {vbox} from '@xh/hoist/cmp/layout';
import {progressBar} from '@xh/hoist/cmp/progressbar';
import {dropRight, isEmpty, isFinite, isPlainObject, isString} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import {CHAT_UI_NUMBER_FORMAT_SCHEMA, fmtChatUiNumber} from './ChatUiFormat';
import {CHAT_UI_INTENTS, toHoistIntent} from './impl/ChatUiIntents';
import type {ChatUiIntent, ChatUiNumberFormat, ChatUiSpecOptions} from './Types';
import './ChatUiProgress.scss';

/** One bar of a progress component, as written by the model. It shows as a Hoist `ProgressBar`. */
export interface ChatUiProgressBar {
    /** What the bar measures, shown over it. */
    label: string;

    /** The value, from 0 to `max`. A value outside that range shows an empty or a full bar. */
    value: number;

    /** Value of a full bar. Default 100, or 1 with the `percent` format. */
    max?: number;

    /**
     * How the figure over the bar shows the value and `max`, such as `$7,200 of $10,000`. With
     * none, the figure is the value as a whole percent of `max`.
     */
    format?: ChatUiNumberFormat;

    /** Color of the fill - for example `danger` for a limit that is close. Default `primary`. */
    intent?: ChatUiIntent;

    /** Value to mark on the bar with a line, for a goal or a threshold. */
    target?: number;
}

/** Props of a progress component, as written by the model. */
export interface ChatUiProgressSpecProps {
    /** The bars, in display order. */
    bars: ChatUiProgressBar[];
}

/** Options for {@link chatUiProgressSpec}. */
export interface ChatUiProgressSpecOptions extends ChatUiSpecOptions {
    /** Most bars the model may send. Default 8. */
    maxItems?: number;
}

/**
 * A progress component for a {@link ChatUiCatalog}: a column of bars, each a value against a
 * maximum, such as usage against a limit or the progress of a task. It renders a Hoist
 * `ProgressBar` per bar, and formats the figure over each. While the props stream, only complete
 * bars show.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiProgressSpec(
    opts: ChatUiProgressSpecOptions = {}
): ChatUiComponentSpec<ChatUiProgressSpecProps> {
    const {name = 'progress', description = DESCRIPTION, maxItems = 8} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['bars'],
            additionalProperties: false,
            properties: {
                bars: {
                    type: 'array',
                    minItems: 1,
                    maxItems,
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
                                    '$10,000". "percent" takes a fraction. Default the percent ' +
                                    'of max.'
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
            const complete = (isPartial ? dropRight(bars) : (bars ?? [])).filter(isBar);
            if (isEmpty(complete)) return null;
            return vbox({
                className: 'xh-chat-ui-progress',
                items: complete.map((bar, idx) => {
                    const max = toMax(bar);
                    return progressBar({
                        key: idx,
                        label: bar.label,
                        value: bar.value,
                        max,
                        valueLabel: toFigure(bar, max),
                        intent: toHoistIntent(bar.intent),
                        target: isFinite(bar.target) ? bar.target : null
                    });
                })
            });
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

// A bar with no number has no place on its track. Hoist reads no value as work of unknown length.
function isBar(bar: unknown): bar is ChatUiProgressBar {
    if (!isPlainObject(bar)) return false;
    const {label, value} = bar as ChatUiProgressBar;
    return isString(label) && !isEmpty(label) && isFinite(value);
}

// A full bar is above zero. A fraction, as the percent format takes it, is full at 1.
function toMax({max, format}: ChatUiProgressBar): number {
    return isFinite(max) && max > 0 ? max : format === 'percent' ? 1 : 100;
}

// The figure over the bar. With no format, Hoist shows the value as a whole percent of `max`.
function toFigure({value, format}: ChatUiProgressBar, max: number): string {
    if (!CHAT_UI_FORMATS.includes(format)) return null;
    const fmt = (it: number) => fmtChatUiNumber(it, format, null, {compact: true, zeroPad: false});
    return format === 'percent' && max === 1 ? `${fmt(value)}` : `${fmt(value)} of ${fmt(max)}`;
}

const CHAT_UI_FORMATS: ChatUiNumberFormat[] = ['number', 'percent', 'currency', 'none'];
