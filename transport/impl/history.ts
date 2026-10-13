import {groupBy, isString, keys, sortBy} from 'lodash';
import type {ChatMessage, ChatPart, ChatToolCallPart} from '../../core';

/**
 * The parts of a message grouped by the step - the model call - that produced them, in step
 * order. Parts with no step, such as those of a user message, count as step 0.
 * @internal
 */
export function partsBySteps(message: ChatMessage): ChatPart[][] {
    const byStep = groupBy(message.parts, it => it.step ?? 0);
    return sortBy(keys(byStep), Number).map(step => byStep[step]);
}

/**
 * The result of a finished tool call as text for the model: the output for a success - as is if
 * a string, else as JSON - or the message for a failure or denial.
 * @internal
 */
export function toolResultText(part: ChatToolCallPart): string {
    const {state, output, errorText} = part;
    if (state !== 'output-available') return errorText;
    return isString(output) ? output : JSON.stringify(output ?? null);
}
