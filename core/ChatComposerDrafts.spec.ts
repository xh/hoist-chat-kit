import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ScriptedChatTransport, scriptedDelay, textEvents} from '../transport';
import {ChatKit} from './ChatKit';
import {ChatModel, type ChatModelConfig} from './ChatModel';

/**
 * Composer drafts in local storage (D67). A draft must survive a reload and a thread switch, must
 * belong to the thread it was typed in, and must go once it is sent - a stale draft that comes
 * back after its message went out would invite a duplicate question.
 */
describe('ChatComposerModel drafts', () => {
    beforeAll(() => initTestAppAsync());

    // A composer saves on destroy, which may run after the test that made it.
    beforeEach(() => ChatKit.clearLocalData());
    afterEach(() => {
        ChatKit.defaults.drafts = 'local';
    });

    it('saves the draft per thread after a pause of 500 ms', async () => {
        vi.useFakeTimers();
        const composer = createChatModel({threadId: 't1'}).composerModel;

        composer.text = 'What is the reserve';
        await vi.advanceTimersByTimeAsync(400);
        expect(savedDraft('t1')).toBeNull();

        await vi.advanceTimersByTimeAsync(100);
        expect(savedDraft('t1')).toMatchObject({text: 'What is the reserve', savedAt: Date.now()});
    });

    it('restores a saved draft when the thread opens again, with a notice', async () => {
        vi.useFakeTimers();
        const first = createChatModel({threadId: 't1'});
        first.composerModel.text = 'Compare reserves';
        await vi.advanceTimersByTimeAsync(500);
        first.destroy();

        const composer = createChatModel({threadId: 't1'}).composerModel;

        expect(composer.text).toBe('Compare reserves');
        expect(composer.restoredDraft).toMatchObject({text: 'Compare reserves'});
        expect(composer.getStatus()).toMatchObject({type: 'draftRestored', action: 'discardDraft'});
    });

    it('keeps text typed in the last pause when the composer is destroyed', () => {
        const chatModel = createChatModel({threadId: 't1'});
        chatModel.composerModel.text = 'Typed just now';
        chatModel.destroy();

        expect(savedDraft('t1')?.text).toBe('Typed just now');
    });

    it('clears the notice on the first keystroke, or after 6 seconds', async () => {
        vi.useFakeTimers();
        saveDraft('t1', 'Compare reserves');

        const first = createChatModel({threadId: 't1'}).composerModel;
        first.text = 'Compare reserves by region';
        expect(first.restoredDraft).toBeNull();

        saveDraft('t2', 'Flag loans');
        const second = createChatModel({threadId: 't2'}).composerModel;
        await vi.advanceTimersByTimeAsync(5900);
        expect(second.restoredDraft).not.toBeNull();
        await vi.advanceTimersByTimeAsync(100);
        expect(second.restoredDraft).toBeNull();
        expect(second.text).toBe('Flag loans');
    });

    it('removes the draft and its notice on Discard', () => {
        saveDraft('t1', 'Compare reserves');
        const composer = createChatModel({threadId: 't1'}).composerModel;

        composer.discardDraft();

        expect(composer.text).toBe('');
        expect(composer.restoredDraft).toBeNull();
        expect(savedDraft('t1')).toBeNull();
    });

    it('removes the draft when its message sends', async () => {
        vi.useFakeTimers();
        const chatModel = createChatModel({threadId: 't1'}),
            composer = chatModel.composerModel;
        composer.text = 'Hello';
        await vi.advanceTimersByTimeAsync(500);
        expect(savedDraft('t1')).not.toBeNull();

        const done = composer.submitAsync();
        expect(savedDraft('t1')).toBeNull();
        await vi.advanceTimersByTimeAsync(1000);
        await done;
        expect(savedDraft('t1')).toBeNull();
    });

    it('keeps each thread its own draft as the chat moves between threads', async () => {
        vi.useFakeTimers();
        saveDraft('t2', 'Draft for two');
        const chatModel = createChatModel({threadId: 't1'}),
            composer = chatModel.composerModel;
        composer.text = 'Draft for one';

        chatModel.loadMessages([{role: 'user', content: 'Earlier'}], 't2');
        expect(composer.text).toBe('Draft for two');
        expect(savedDraft('t1')?.text).toBe('Draft for one');

        chatModel.loadMessages([{role: 'user', content: 'Earlier'}], 't1');
        expect(composer.text).toBe('Draft for one');
    });

    it('moves the draft to the id the backend gives a new thread', async () => {
        vi.useFakeTimers();
        const chatModel = createChatModel({
                transport: new ScriptedChatTransport({
                    responses: [[scriptedDelay(2000), ...textEvents('Hi.')]],
                    delayMs: 0
                })
            }),
            composer = chatModel.composerModel,
            localId = chatModel.threadId;
        chatModel.setThreadCreator(
            () => new Promise(resolve => setTimeout(() => resolve('server-1'), 1000))
        );

        const done = chatModel.sendAsync('First question');
        composer.text = 'Next question';
        await vi.advanceTimersByTimeAsync(600);
        expect(savedDraft(localId)?.text).toBe('Next question');

        await vi.advanceTimersByTimeAsync(3000);
        await done;
        expect(chatModel.threadId).toBe('server-1');
        expect(composer.text).toBe('Next question');
        expect(savedDraft('server-1')?.text).toBe('Next question');
        expect(savedDraft(localId)).toBeNull();
    });

    it('keeps attachments in memory only', async () => {
        const composer = createChatModel({
            threadId: 't1',
            composer: {enableAttachments: true}
        }).composerModel;
        // The file reads on a real timer.
        await composer.addFilesAsync([new File(['x'], 'tape.csv', {type: 'text/csv'})]);
        vi.useFakeTimers();
        composer.text = 'See the tape';
        await vi.advanceTimersByTimeAsync(500);

        expect(savedDraft('t1')).toEqual({text: 'See the tape', savedAt: Date.now()});
    });

    it('saves nothing with drafts in memory, by default or for one composer', async () => {
        vi.useFakeTimers();
        createChatModel({threadId: 't1', composer: {drafts: 'memory'}}).composerModel.text = 'A';
        ChatKit.defaults.drafts = 'memory';
        createChatModel({threadId: 't2'}).composerModel.text = 'B';
        await vi.advanceTimersByTimeAsync(500);

        expect(savedDraft('t1')).toBeNull();
        expect(savedDraft('t2')).toBeNull();
    });

    it('removes every kit key with clearLocalData, and leaves the app its own', () => {
        saveDraft('t1', 'One');
        saveDraft('t2', 'Two');
        XH.localStorageService.set('appSetting', {theme: 'dark'});

        ChatKit.clearLocalData();

        expect(savedDraft('t1')).toBeNull();
        expect(savedDraft('t2')).toBeNull();
        expect(XH.localStorageService.get('appSetting')).toEqual({theme: 'dark'});
        XH.localStorageService.remove('appSetting');
    });
});

//------------------
// Helpers
//------------------
function createChatModel(config: Partial<ChatModelConfig> = {}): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        ...config
    });
    onTestFinished(() => model.destroy());
    return model;
}

function savedDraft(threadId: string) {
    return XH.localStorageService.get(`xhChat.draft.${threadId}`, null);
}

function saveDraft(threadId: string, text: string) {
    XH.localStorageService.set(`xhChat.draft.${threadId}`, {text, savedAt: Date.now()});
}
