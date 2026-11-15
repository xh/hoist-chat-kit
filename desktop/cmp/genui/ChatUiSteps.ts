import {steps as hoistSteps, type StepSpec, type StepStatus} from '@xh/hoist/cmp/steps';
import {dropRight, isEmpty, isInteger, isPlainObject, isString} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiSpecOptions} from './Types';

/** Where a step stands in its sequence, as written by the model. */
export type ChatUiStepStatus = 'pending' | 'current' | 'complete' | 'warning' | 'error';

/** One step of a steps component, as written by the model. */
export interface ChatUiStep {
    /** Name of the step. */
    title: string;

    /** Longer text under the title, such as what the step does or what went wrong. */
    description?: string;

    /** Short text set apart from the title, such as a date or an owner. */
    detail?: string;

    /** Status of the step. Default the status that `current` gives it, or `pending`. */
    status?: ChatUiStepStatus;
}

/** Props of a steps component, as written by the model. */
export interface ChatUiStepsSpecProps {
    /** The steps, in order. */
    steps: ChatUiStep[];

    /**
     * Index of the current step, from 0. Steps before it are complete, and steps after it are
     * pending. A step's own `status` wins.
     */
    current?: number;

    /** `horizontal` for a row, or `vertical` for a list with text beside each marker. */
    orientation?: 'horizontal' | 'vertical';
}

/** Options for {@link chatUiStepsSpec}. */
export interface ChatUiStepsSpecOptions extends ChatUiSpecOptions {
    /** Most steps the model may send. Default 8. */
    maxItems?: number;
}

/**
 * A steps component for a {@link ChatUiCatalog}: an ordered sequence of steps with a status each,
 * such as the stages of an order or the checks of a workflow. It renders Hoist's `Steps`. Each
 * marker shows the number of its step, or the icon of its status. The model writes no icon, and
 * a step takes no click. While the props stream, only complete steps show.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiStepsSpec(
    opts: ChatUiStepsSpecOptions = {}
): ChatUiComponentSpec<ChatUiStepsSpecProps> {
    const {name = 'steps', description = DESCRIPTION, maxItems = 8} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['steps'],
            additionalProperties: false,
            properties: {
                steps: {
                    type: 'array',
                    minItems: 1,
                    maxItems,
                    items: {
                        type: 'object',
                        required: ['title'],
                        additionalProperties: false,
                        properties: {
                            title: {type: 'string', minLength: 1, maxLength: 60},
                            description: {
                                type: 'string',
                                maxLength: 200,
                                description: 'Longer text under the title.'
                            },
                            detail: {
                                type: 'string',
                                maxLength: 40,
                                description: 'Short text beside the title, such as a date.'
                            },
                            status: {
                                enum: STATUSES,
                                description: 'Default the status that current gives the step.'
                            }
                        }
                    }
                },
                current: {
                    type: 'integer',
                    minimum: 0,
                    description:
                        'Index of the current step, from 0. Steps before it are complete, ' +
                        'steps after it pending.'
                },
                orientation: {
                    enum: ['horizontal', 'vertical'],
                    description:
                        '"vertical" for a list, with long descriptions. Default "horizontal".'
                }
            }
        },
        standalone: false,
        render: ({steps, current, orientation}, {isPartial}) => {
            // While streaming, the last step may be cut short - its title still being written.
            const complete = (isPartial ? dropRight(steps) : (steps ?? [])).flatMap(toStep);
            if (isEmpty(complete)) return null;
            return hoistSteps({
                className: 'xh-chat-ui-steps',
                steps: complete,
                current: isInteger(current) && current >= 0 ? current : null,
                orientation: orientation === 'vertical' ? 'vertical' : 'horizontal'
            });
        },
        result: ({steps}) => steps.map(it => it.title).join(', '),
        example: {
            steps: [
                {title: 'Ordered', detail: 'May 2'},
                {title: 'Shipped', detail: 'May 4'},
                {title: 'Delivered'}
            ],
            current: 1
        }
    };
}

//------------------
// Implementation
//------------------
const STATUSES: StepStatus[] = ['pending', 'current', 'complete', 'warning', 'error'];

const DESCRIPTION =
    'An ordered sequence of steps, each with a status. Use it for the stages of a process, a ' +
    'checklist or a timeline. Set current, or a status on each step.';

// A step of plain text for Hoist's `Steps`, or none for a value that is not a step. Hoist renders
// each string as text.
function toStep(step: unknown): StepSpec[] {
    if (!isPlainObject(step)) return [];
    const {title, description, detail, status} = step as ChatUiStep;
    if (!isString(title) || isEmpty(title)) return [];
    return [
        {
            title,
            description: isString(description) && description ? description : null,
            detail: isString(detail) && detail ? detail : null,
            status: STATUSES.includes(status) ? status : null
        }
    ];
}
