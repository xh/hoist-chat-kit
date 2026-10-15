import {observable, runInAction} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ScriptedChatTransport, textEvents} from '../transport';
import type {ChatComposerHost} from './ChatComposerHost';
import {type ChatComposerConfig, ChatComposerModel} from './ChatComposerModel';
import {ChatModel, type ChatSendSpec} from './ChatModel';

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

    describe('sendBlocker', () => {
        it('blocks sending while it gives a reason, and follows the state it reads', async () => {
            const state = observable({hasDocument: false}),
                chatModel = new ChatModel({
                    transport: new ScriptedChatTransport({responses: [textEvents('Hi.')]}),
                    sendBlocker: () => (state.hasDocument ? null : 'Choose a document first.')
                }),
                composer = chatModel.composerModel;
            onTestFinished(() => chatModel.destroy());

            composer.text = 'Summarize it';
            expect(chatModel.sendBlockedReason).toBe('Choose a document first.');
            expect(composer.canSend).toBe(false);

            await chatModel.sendAsync('Summarize it');
            expect(chatModel.messages).toEqual([]);

            runInAction(() => (state.hasDocument = true));
            expect(chatModel.sendBlockedReason).toBeNull();
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

    describe('with a host of its own', () => {
        it('sends the trimmed draft through the host and clears it', async () => {
            const {host} = createHost(),
                composer = createComposer(host);
            composer.text = '  Hello  ';

            await composer.submitAsync();

            expect(host.sendAsync).toHaveBeenCalledExactlyOnceWith({text: 'Hello', files: []});
            expect(composer.text).toBe('');
        });

        it('keeps the draft while the host is busy or gives a reason to wait', async () => {
            const {host, state} = createHost(),
                composer = createComposer(host);
            composer.text = 'Hello';

            runInAction(() => (state.isBusy = true));
            expect(composer.canSend).toBe(false);
            await composer.submitAsync();

            runInAction(() => {
                state.isBusy = false;
                state.sendBlockedReason = 'Choose a document first.';
            });
            expect(composer.canSend).toBe(false);
            await composer.submitAsync();

            expect(host.sendAsync).not.toHaveBeenCalled();
            expect(composer.text).toBe('Hello');

            runInAction(() => (state.sendBlockedReason = null));
            expect(composer.canSend).toBe(true);
        });

        it('recalls the last user message only if the host has messages', () => {
            const withMessages = createComposer(
                    createHost({
                        messages: [
                            {isUser: true, text: 'First'},
                            {isUser: false, text: 'Reply'}
                        ]
                    }).host
                ),
                withoutMessages = createComposer(createHost().host);

            withMessages.recallLastMessage();
            withoutMessages.recallLastMessage();

            expect(withMessages.text).toBe('First');
            expect(withoutMessages.text).toBe('');
        });
    });

    describe('settings', () => {
        it('applies attachment settings changed after construction', async () => {
            const composer = createChatModel().composerModel;
            await expect(composer.addFilesAsync([file('a.txt')])).rejects.toThrow('not enabled');

            composer.enableAttachments = true;
            composer.maxFiles = 1;
            composer.accept = ['.csv'];
            await composer.addFilesAsync([file('a.csv'), file('b.csv'), file('c.txt')]);

            expect(composer.attachments.map(it => it.name)).toEqual(['a.csv']);
            expect(composer.attachmentErrors).toEqual([
                "'c.txt' is not an accepted file type.",
                'File limit of 1 reached - 1 file not added.'
            ]);
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

        it('rejects files of other types, and names them in attachmentErrors', async () => {
            const composer = createChatModel({
                enableAttachments: true,
                accept: ['image/*', '.CSV']
            }).composerModel;

            await composer.addFilesAsync([
                file('chart.png', 'image/png'),
                file('data.csv', 'text/csv'),
                file('virus.exe', 'application/x-msdownload')
            ]);

            expect(composer.attachments.map(it => it.name)).toEqual(['chart.png', 'data.csv']);
            expect(composer.attachmentErrors).toEqual([
                "'virus.exe' is not an accepted file type."
            ]);

            await composer.addFilesAsync([file('more.png', 'image/png')]);
            expect(composer.attachmentErrors).toEqual([]);
        });

        it('rejects files over the size limit', async () => {
            const composer = createChatModel({
                enableAttachments: true,
                maxFileSize: 1024
            }).composerModel;

            await composer.addFilesAsync([file('big.pdf', 'application/pdf', 'x'.repeat(2048))]);

            expect(composer.attachments).toEqual([]);
            expect(composer.attachmentErrors).toEqual(["'big.pdf' is larger than 1 KB."]);
        });

        it('stops at the file limit', async () => {
            const composer = createChatModel({enableAttachments: true, maxFiles: 2}).composerModel;

            await composer.addFilesAsync([file('a.txt'), file('b.txt'), file('c.txt')]);

            expect(composer.attachments.map(it => it.name)).toEqual(['a.txt', 'b.txt']);
            expect(composer.attachmentErrors).toEqual([
                'File limit of 2 reached - 1 file not added.'
            ]);
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
function createChatModel(composer: Omit<ChatComposerConfig, 'host'> = {}): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({respond: () => textEvents('Reply.'), delayMs: 10}),
        composer
    });
    onTestFinished(() => model.destroy());
    return model;
}

/** A host over observable app state, with no ChatModel. */
function createHost(extra: Partial<ChatComposerHost> = {}) {
    const state = observable({isBusy: false, sendBlockedReason: null as string}),
        host = {
            get isBusy() {
                return state.isBusy;
            },
            get sendBlockedReason() {
                return state.sendBlockedReason;
            },
            sendAsync: vi.fn(async (_spec: ChatSendSpec) => {}),
            ...extra
        };
    return {host, state};
}

function createComposer(host: ChatComposerHost): ChatComposerModel {
    const composer = new ChatComposerModel({host});
    onTestFinished(() => composer.destroy());
    return composer;
}

function file(name: string, type: string = 'text/plain', content: string = 'x'): File {
    return new File([content], name, {type});
}
