import {describe, expect, it} from 'vitest';
import type {ChatToolCallPart, ChatToolCallState, ChatToolSpec} from '../../../../core';
import {getInlineStatus} from './ToolCallStatus';

/**
 * An inline tool call - generative UI - shows its rendered output as its progress. Apps rely on it
 * showing a status only while the output cannot speak for itself, and never "Pending" or "Running"
 * under a component that has already rendered.
 */
describe('getInlineStatus', () => {
    const spec: ChatToolSpec = {name: 'show_chart', displayName: 'Chart', display: 'inline'};

    it.each<[ChatToolCallState, string]>([
        ['input-streaming', 'Rendering…'],
        ['approval-requested', 'Needs approval'],
        ['output-error', 'Could not show the chart.'],
        ['output-denied', 'Denied - not shown.']
    ])('shows a status for a %s call', (state, label) => {
        expect(getInlineStatus(call(state), spec)?.label).toBe(label);
    });

    it.each<ChatToolCallState>(['input-available', 'running', 'output-available'])(
        'shows no status for a %s call, as the rendered output is the progress',
        state => {
            expect(getInlineStatus(call(state), spec)).toBeNull();
        }
    );

    it('keeps the error text, written for the model, out of the status', () => {
        const status = getInlineStatus(
            call('output-error', 'Invalid props - nothing was shown. Fix and retry:'),
            spec
        );
        expect(status).toEqual({type: 'error', label: 'Could not show the chart.'});
    });
});

function call(state: ChatToolCallState, errorText: string = null): ChatToolCallPart {
    return {
        type: 'toolCall',
        id: 'c1',
        toolName: 'show_chart',
        state,
        inputText: '{}',
        input: {},
        output: null,
        errorText
    };
}
