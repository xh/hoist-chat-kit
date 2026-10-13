import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ScriptedChatTransport, textEvents} from '../transport';
import type {ChatComposerConfig} from './ChatComposerModel';
import {ChatModel} from './ChatModel';

/**
 * ChatComposerModel holds the draft of the next message. Its send rules decide when the user can
 * send, and its attachment rules guard what reaches the model - a rejected file must never be sent
 * silently, and the user must hear why.
 */
describe('ChatComposerModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('canSend', () => {
        it('is true only for a non-empty draft while the chat is idle', async () => {
            vi.useFakeTimers();
            const chatModel = createChatModel(),
                composer = chatModel.composerModel;
            expect(composer.canSend).toBe(false);

            composer.text = '   ';
            expect(composer.canSend).toBe(false);

            composer.text = 'Hello';
            expect(composer.canSend).toBe(true);

            const done = composer.submitAsync();
            expect(chatModel.isBusy).toBe(true);
            composer.text = 'Another';
            expect(composer.canSend).toBe(false);

            await vi.advanceTimersByTimeAsync(5000);
            await done;
            expect(composer.canSend).toBe(true);
        });
    });

    describe('submitAsync', () => {
        it('sends the draft and clears it', async () => {
            const chatModel = createChatModel(),
                composer = chatModel.composerModel;
            composer.text = 'Hello';

            await composer.submitAsync();

            expect(chatModel.messages[0].text).toBe('Hello');
            expect(composer.text).toBe('');
        });
    });

    describe('addFilesAsync', () => {
        it('attaches files as base64 file parts', async () => {
            const composer = createChatModel({enableAttachments: true}).composerModel;

            await composer.addFilesAsync([file('notes.txt', 'text/plain', 'hello')]);

            expect(composer.attachments).toMatchObject([
                {
                    type: 'file',
                    name: 'notes.txt',
                    mediaType: 'text/plain',
                    size: 5,
                    data: btoa('hello')
                }
            ]);
            expect(composer.isEmpty).toBe(false);
        });

        it('rejects files of other types, with a warning toast', async () => {
            const toast = vi.spyOn(XH, 'warningToast').mockReturnValue(null),
                composer = createChatModel({
                    enableAttachments: true,
                    accept: ['image/*', '.CSV']
                }).composerModel;

            await composer.addFilesAsync([
                file('chart.png', 'image/png'),
                file('data.csv', 'text/csv'),
                file('virus.exe', 'application/x-msdownload')
            ]);

            expect(composer.attachments.map(it => it.name)).toEqual(['chart.png', 'data.csv']);
            expect(toast).toHaveBeenCalledExactlyOnceWith(
                "'virus.exe' is not an accepted file type."
            );
        });

        it('rejects files over the size limit', async () => {
            const toast = vi.spyOn(XH, 'warningToast').mockReturnValue(null),
                composer = createChatModel({
                    enableAttachments: true,
                    maxFileSize: 1024
                }).composerModel;

            await composer.addFilesAsync([file('big.pdf', 'application/pdf', 'x'.repeat(2048))]);

            expect(composer.attachments).toEqual([]);
            expect(toast).toHaveBeenCalledWith("'big.pdf' is larger than 1 KB.");
        });

        it('stops at the file limit', async () => {
            const toast = vi.spyOn(XH, 'warningToast').mockReturnValue(null),
                composer = createChatModel({enableAttachments: true, maxFiles: 2}).composerModel;

            await composer.addFilesAsync([file('a.txt'), file('b.txt'), file('c.txt')]);

            expect(composer.attachments.map(it => it.name)).toEqual(['a.txt', 'b.txt']);
            expect(toast).toHaveBeenCalledWith('File limit of 2 reached - 1 file not added.');
        });

        it('throws when attachments are not enabled', async () => {
            const composer = createChatModel().composerModel;
            await expect(composer.addFilesAsync([file('a.txt')])).rejects.toThrow(
                'Attachments are not enabled'
            );
        });
    });

    describe('recallLastMessage', () => {
        it('puts the last user message into an empty draft, and leaves a draft alone', async () => {
            const chatModel = createChatModel(),
                composer = chatModel.composerModel;
            await chatModel.sendAsync('What is Hoist?');

            composer.recallLastMessage();
            expect(composer.text).toBe('What is Hoist?');

            composer.text = 'Draft in progress';
            composer.recallLastMessage();
            expect(composer.text).toBe('Draft in progress');
        });
    });
});

//------------------
// Helpers
//------------------
function createChatModel(composer: ChatComposerConfig = {}): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({respond: () => textEvents('Reply.'), delayMs: 10}),
        composer
    });
    onTestFinished(() => model.destroy());
    return model;
}

function file(name: string, type: string = 'text/plain', content: string = 'x'): File {
    return new File([content], name, {type});
}
