import {fireEvent, render, screen} from '@testing-library/react';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatScopeChip, type ChatScopeDocument} from './ChatScopeChip';

/**
 * The document scope chip (B4). Each question must record the scope the user saw on the chip, so
 * the chip's label and the chat's run options must agree, and Clear must mean all documents.
 */
describe('ChatScopeChip', () => {
    beforeAll(() => initTestAppAsync());

    const DOCS: ChatScopeDocument[] = [
        {id: 'd1', name: 'Policy manual'},
        {id: 'd2', name: 'Servicing guide'},
        {id: 'd3', name: 'Credit memo'}
    ];

    it('reads "All documents" with nothing chosen', () => {
        render(chatScopeChip({model: createModel(), documents: DOCS}));

        const chip = screen.getByRole('button', {name: 'Document scope: All documents'});
        expect(chip.textContent).toBe('All documents');
    });

    it('records the chosen documents in the run options, with the count on the chip', () => {
        const chatModel = createModel();
        render(chatScopeChip({model: chatModel, documents: DOCS}));

        openChip();
        fireEvent.click(screen.getByRole('checkbox', {name: 'Policy manual'}));
        fireEvent.click(screen.getByRole('checkbox', {name: 'Credit memo'}));

        expect(chatModel.runOptions).toEqual({documentIds: ['d1', 'd3']});
        const chip = screen.getByRole('button', {name: 'Document scope: 2 documents'});
        expect(chip.textContent).toBe('Documents2');
        expect(chip.getAttribute('title')).toBe('Policy manual, Credit memo');
    });

    it('counts only chosen documents that are still in the list', () => {
        render(
            chatScopeChip({
                model: createModel({documentIds: ['d1', 'gone', 'd3']}),
                documents: DOCS
            })
        );

        const chip = screen.getByRole('button', {name: 'Document scope: 2 documents'});
        expect(chip.textContent).toBe('Documents2');
        openChip();
        expect(screen.getByText('2 of 3')).toBeTruthy();
    });

    it('clears the scope to all documents, keeping other run options', () => {
        const chatModel = createModel({documentIds: ['d2'], profile: 'thorough'});
        render(chatScopeChip({model: chatModel, documents: DOCS}));

        openChip();
        fireEvent.click(screen.getByRole('button', {name: 'Clear'}));

        expect(chatModel.runOptions).toEqual({profile: 'thorough'});
        expect(screen.getByRole('button', {name: 'Document scope: All documents'})).toBeTruthy();
    });

    it('sends each question with the scope chosen when it was asked', async () => {
        const chatModel = createModel();
        render(chatScopeChip({model: chatModel, documents: DOCS}));

        openChip();
        fireEvent.click(screen.getByRole('checkbox', {name: 'Servicing guide'}));
        await chatModel.sendAsync('What does it say about escrow?');

        expect(chatModel.messages[0].metadata.runOptions).toEqual({documentIds: ['d2']});
    });

    it('binds to the app state given as value and onChange, with no chat', () => {
        const onChange = vi.fn();
        // Under an app's own model, as in any app - Hoist inputs look one up in context.
        render(appHost({item: chatScopeChip({documents: DOCS, value: ['d1'], onChange})}));

        openChip();
        fireEvent.click(screen.getByRole('checkbox', {name: 'Servicing guide'}));

        expect(onChange).toHaveBeenCalledWith(['d1', 'd2']);
    });

    it('searches a long list by name', () => {
        const docs = Array.from({length: 12}, (_, idx) => ({id: `d${idx}`, name: `Guide ${idx}`}));
        render(chatScopeChip({model: createModel(), documents: [...docs, ...DOCS]}));

        openChip();
        changeSearch('memo');
        expect(screen.getAllByRole('checkbox').map(labelOf)).toEqual(['Credit memo']);

        changeSearch('escrow');
        expect(screen.getByText("No documents match 'escrow'")).toBeTruthy();
    });

    it('opens nothing while read-only', () => {
        render(chatScopeChip({model: createModel(), documents: DOCS, readonly: true}));

        const chip = screen.getByRole('button', {name: 'Document scope: All documents'});
        fireEvent.click(chip);

        expect(chip.getAttribute('aria-disabled')).toBe('true');
        expect(screen.queryByRole('checkbox')).toBeNull();
    });
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

function openChip() {
    fireEvent.click(screen.getByRole('button', {name: /^Document scope/}));
}

function changeSearch(text: string) {
    fireEvent.change(screen.getByRole('textbox', {name: 'Search documents'}), {
        target: {value: text}
    });
}

function labelOf(checkbox: HTMLElement): string {
    return checkbox.closest('label')?.textContent ?? null;
}
