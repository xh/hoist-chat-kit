import {fireEvent, render, screen} from '@testing-library/react';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatScopeChip, type ChatScopeOption} from './ChatScopeChip';

/**
 * The scope chip (B4). Each question must record the selection the user saw on the chip, so the
 * chip's words and the chat's run options must agree. The selection is literal: empty means none,
 * and a locked item never changes.
 */
describe('ChatScopeChip', () => {
    beforeAll(() => initTestAppAsync());

    const DOCS: ChatScopeOption[] = [
        {id: 'd1', name: 'Policy manual'},
        {id: 'd2', name: 'Servicing guide'},
        {id: 'd3', name: 'Credit memo'}
    ];

    it('reads "No documents" with none checked, and "All documents" with every one', () => {
        const {unmount} = render(chatScopeChip({...docChip(), model: createModel()}));
        expect(chip('No documents').textContent).toBe('No documents');
        unmount();

        render(
            chatScopeChip({...docChip(), model: createModel({documentIds: ['d1', 'd2', 'd3']})})
        );
        expect(chip('All documents').textContent).toBe('All documents');
    });

    it('records the checked items in the run options, with the count on the chip', () => {
        const chatModel = createModel();
        render(chatScopeChip({...docChip(), model: chatModel}));

        openChip();
        fireEvent.click(screen.getByRole('checkbox', {name: 'Policy manual'}));
        fireEvent.click(screen.getByRole('checkbox', {name: 'Credit memo'}));

        expect(chatModel.runOptions).toEqual({documentIds: ['d1', 'd3']});
        expect(chip('2 of 3').textContent).toBe('Documents2');
        expect(chip('2 of 3').getAttribute('title')).toBe('Policy manual, Credit memo');
    });

    it('gives each item its full name as a tooltip, as a long one truncates', () => {
        const name = 'Mortgage Underwriting Guidelines: Credit, Capacity, Collateral and Reserves';
        render(
            chatScopeChip({
                ...docChip(),
                model: createModel(),
                options: [{id: 'd0', name}, ...DOCS]
            })
        );

        openChip();
        const option = screen.getByRole('checkbox', {name}).closest('label');
        expect(option.querySelector('[title]').getAttribute('title')).toBe(name);
    });

    it('counts only checked items that are still in the list', () => {
        render(
            chatScopeChip({...docChip(), model: createModel({documentIds: ['d1', 'gone', 'd3']})})
        );

        expect(chip('2 of 3').textContent).toBe('Documents2');
        openChip();
        expect(screen.getByText('2 of 3')).toBeTruthy();
    });

    it('clears to none and selects all, keeping other run options', () => {
        const chatModel = createModel({documentIds: ['d2'], profile: 'thorough'});
        render(chatScopeChip({...docChip(), model: chatModel}));

        openChip();
        fireEvent.click(screen.getByRole('button', {name: 'Clear'}));
        expect(chatModel.runOptions).toEqual({documentIds: [], profile: 'thorough'});
        expect(chip('No documents')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', {name: 'Select All'}));
        expect(chatModel.runOptions).toEqual({
            documentIds: ['d1', 'd2', 'd3'],
            profile: 'thorough'
        });
        expect(chip('All documents')).toBeTruthy();
    });

    it('leaves a disabled item as it is, and shows its secondary text and info', async () => {
        const onChange = vi.fn(),
            tools: ChatScopeOption[] = [
                {id: 't1', name: 'Prices', disabled: true, secondaryText: 'Required for skill'},
                {id: 't2', name: 'Curves', info: 'Provider: Commodities'},
                {id: 't3', name: 'Archive', disabled: true}
            ];
        render(
            appHost({item: chatScopeChip({options: tools, noun: 'tool', value: ['t1'], onChange})})
        );

        fireEvent.click(screen.getByRole('button', {name: /^Tools:/}));
        expect(screen.getByRole('checkbox', {name: 'Prices'})).toHaveProperty('disabled', true);
        expect(screen.getByText('Required for skill')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', {name: 'Select All'}));
        expect(onChange).toHaveBeenLastCalledWith(['t1', 't2']);
        expect(screen.getByRole('button', {name: 'Clear'})).toHaveProperty('disabled', true);

        fireEvent.mouseEnter(screen.getByRole('img', {name: 'About Curves'}));
        expect(await screen.findByText('Provider: Commodities')).toBeTruthy();
    });

    it('sends each question with the selection checked when it was asked', async () => {
        const chatModel = createModel();
        render(chatScopeChip({...docChip(), model: chatModel}));

        openChip();
        fireEvent.click(screen.getByRole('checkbox', {name: 'Servicing guide'}));
        await chatModel.sendAsync('What does it say about escrow?');

        expect(chatModel.messages[0].metadata.runOptions).toEqual({documentIds: ['d2']});
    });

    it('binds to the app state given as value and onChange, with no chat', () => {
        const onChange = vi.fn();
        // Under an app's own model, as in any app - Hoist inputs look one up in context.
        render(
            appHost({
                item: chatScopeChip({options: DOCS, noun: 'document', value: ['d1'], onChange})
            })
        );

        openChip();
        fireEvent.click(screen.getByRole('checkbox', {name: 'Servicing guide'}));

        expect(onChange).toHaveBeenCalledWith(['d1', 'd2']);
    });

    it('searches a long list by name', () => {
        const docs = Array.from({length: 12}, (_, idx) => ({id: `g${idx}`, name: `Guide ${idx}`}));
        render(chatScopeChip({...docChip(), model: createModel(), options: [...docs, ...DOCS]}));

        openChip();
        changeSearch('memo');
        expect(screen.getAllByRole('checkbox').map(labelOf)).toEqual(['Credit memo']);

        changeSearch('escrow');
        expect(screen.getByText("No documents match 'escrow'")).toBeTruthy();
    });

    it('requires runOption to bind to a chat', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(chatScopeChip({options: DOCS, model: createModel()}))).toThrow(
            'requires a ChatModel with runOption'
        );
    });

    function docChip() {
        return {options: DOCS, noun: 'document', runOption: 'documentIds'};
    }
});

//------------------
// Helpers
//------------------
class AppModel extends HoistModel {}

const appHost = hoistCmp.factory({
    model: creates(AppModel),
    render: ({children}) => children
});

function createModel(runOptions: Record<string, any> = null): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        runOptions,
        composer: {drafts: 'memory'}
    });
    onTestFinished(() => model.destroy());
    return model;
}

function chip(spoken: string): HTMLElement {
    return screen.getByRole('button', {name: `Documents: ${spoken}`});
}

function openChip() {
    fireEvent.click(screen.getByRole('button', {name: /^Documents:/}));
}

function changeSearch(text: string) {
    fireEvent.change(screen.getByRole('textbox', {name: 'Search documents'}), {
        target: {value: text}
    });
}

function labelOf(checkbox: HTMLElement): string {
    return checkbox.closest('label')?.textContent ?? null;
}
