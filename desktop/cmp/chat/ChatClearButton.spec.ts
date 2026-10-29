import {fireEvent, render, screen} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {ScriptedChatTransport} from '../../../transport';
import {chatClearButton} from './ChatClearButton';

describe('ChatClearButton', () => {
    beforeAll(() => initTestAppAsync());

    it('clears the conversation, then runs the onClick passed in props', async () => {
        const onClick = vi.fn(),
            chatModel = createModel();
        render(chatClearButton({chatModel, onClick}));

        fireEvent.click(screen.getByRole('button', {name: 'Clear conversation'}));
        await vi.waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));

        expect(chatModel.isEmpty).toBe(true);
    });

    it('is disabled while the conversation is empty', () => {
        const chatModel = createModel();
        chatModel.clear();
        render(chatClearButton({chatModel}));

        expect(screen.getByRole('button', {name: 'Clear conversation'})).toHaveProperty(
            'disabled',
            true
        );
    });
});

//------------------
// Helpers
//------------------
function createModel(): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport(),
        initialMessages: [{role: 'user', content: 'Hello'}]
    });
    onTestFinished(() => model.destroy());
    return model;
}
