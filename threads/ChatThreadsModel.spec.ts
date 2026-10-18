import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, type ChatModelConfig, ChatRunError} from '../core';
import {
    type ChatEvent,
    type ChatRunRequest,
    errorEvents,
    ScriptedChatTransport,
    type ScriptedRequestContext,
    type ScriptedResponse,
    textEvents,
    toolCallEvents
} from '../transport';
import {type ChatThreadsConfig, ChatThreadsModel} from './ChatThreadsModel';
import {type LocalChatThread, LocalChatThreadStore} from './LocalChatThreadStore';

/**
 * The thread layer's contract. Apps rely on it to keep each conversation's state in its own chat,
 * to run turns in the background, and to apply every async result - list, history or run - only
 * where it still belongs. The concurrency rules of the server-mode spec (section 3.3) each have a
 * test here. They guard the races that each enterprise app hit when it built a thread sidebar by
 * hand.
 */
describe('ChatThreadsModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('thread list', () => {
        it('lists the threads from the store, most recent first, with the actions it has', async () => {
            const {model} = setup();

            await model.loadAsync();

            expect(ids(model.threads)).toEqual(['t1', 't2', 't3']);
            expect(model).toMatchObject({canRename: true, canDelete: true});
        });

        it('hides the actions the store lacks', async () => {
            const {model} = setup({
                store: new LocalChatThreadStore({omit: ['renameThreadAsync']})
            });

            expect(model).toMatchObject({canRename: false, canDelete: true});
            await expect(model.renameThreadAsync('t1', 'New')).rejects.toThrow('cannot rename');
        });

        it('searches on the server, debounced, and drops results for an older search', async () => {
            vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
            const {model, store} = setup();
            await model.loadAsync();

            store.hold('listThreadsAsync');
            model.search = 'bud';
            await vi.advanceTimersByTimeAsync(300);
            model.search = '  trav ';
            await vi.advanceTimersByTimeAsync(300);

            const [budget, travel] = store.heldCalls('listThreadsAsync');
            expect([budget.args[0].search, travel.args[0].search]).toEqual(['bud', 'trav']);
            travel.release();
            budget.release();
            await vi.advanceTimersByTimeAsync(0);

            expect(ids(model.threads)).toEqual(['t2']);
        });

        it('keeps its threads, and reports the error, when a list fails', async () => {
            const handleException = spyHandleException(),
                {model, store} = setup();
            await model.loadAsync();

            store.failNext('listThreadsAsync');
            await model.refreshAsync();

            expect(ids(model.threads)).toEqual(['t1', 't2', 't3']);
            expect(model.listError.message).toBe('listThreadsAsync failed.');
            expect(handleException).toHaveBeenCalledWith(model.listError, {showAlert: false});
        });
    });

    describe('concurrency rules', () => {
        it('1. applies a list only if no newer list has applied', async () => {
            const {model, store} = setup();
            store.hold('listThreadsAsync');

            const first = model.loadAsync();
            store.saveThread({id: 't4', title: 'Fresh'});
            const second = model.refreshAsync();
            const [older, newer] = store.heldCalls('listThreadsAsync');
            newer.release();
            await second;
            older.release();
            await first;

            expect(ids(model.threads)).toEqual(['t4', 't1', 't2', 't3']);
        });

        it('1. lays pending renames and deletes over a list, by id', async () => {
            const {model, store} = setup();
            await model.loadAsync();
            store.hold('renameThreadAsync');
            store.hold('deleteThreadsAsync');

            const renamed = model.renameThreadAsync('t1', 'Renamed'),
                deleted = model.deleteThreadsAsync(['t2']);
            await model.refreshAsync();

            expect(model.threads.map(it => it.title)).toEqual(['Renamed', 'Q3 forecast']);
            store.heldCalls().forEach(it => it.release());
            await Promise.all([renamed, deleted]);
            await model.refreshAsync();
            expect(model.threads.map(it => it.title)).toEqual(['Renamed', 'Q3 forecast']);
        });

        it('1. keeps a deleted thread out of a list requested before the delete ended', async () => {
            const {model, store} = setup();
            await model.loadAsync();
            store.hold('listThreadsAsync');

            const staleList = model.refreshAsync();
            await model.deleteThreadsAsync(['t2']);
            store.heldCalls('listThreadsAsync')[0].release();
            await staleList;

            expect(ids(model.threads)).toEqual(['t1', 't3']);
        });

        it('2. discards a history load for a thread the user has left, and only logs its failure', async () => {
            const handleException = spyHandleException(),
                {model, store} = setup();
            store.hold('loadMessagesAsync');

            const leftLoad = model.selectThreadAsync('t1'),
                currentLoad = model.selectThreadAsync('t2');
            const [left, current] = store.heldCalls('loadMessagesAsync');
            current.release();
            await currentLoad;
            left.fail(new Error('Thread t1 failed'));
            await leftLoad;

            expect(model.selectedThreadId).toBe('t2');
            expect(texts(model.chatModel)).toEqual(['Plan a trip', 'Where to?']);
            expect(model.loadError).toBeNull();
            expect(model.chatModel.sendBlockedReason).toBeNull();
            expect(handleException).not.toHaveBeenCalled();
        });

        it("3. never shows the old thread's messages in a new thread opened during a load", async () => {
            const {model, store} = setup();
            store.hold('loadMessagesAsync');

            const load = model.selectThreadAsync('t1'),
                chatModel = model.newThread();
            store.heldCalls('loadMessagesAsync')[0].release();
            await load;

            expect(model.chatModel).toBe(chatModel);
            expect(chatModel.isEmpty).toBe(true);
            expect(chatModel.threadId).not.toBe('t1');
        });

        it("4. applies each run's events only to that run's chat", async () => {
            const turns = new TurnGates(),
                {model, transport} = setup({respond: turns.respond}),
                first = model.newThread();
            const firstDone = first.sendAsync('First question');
            const second = model.newThread(),
                secondDone = second.sendAsync('Second question');

            turns.open(second.threadId);
            await secondDone;
            turns.open(first.threadId);
            await firstDone;

            expect(texts(first)).toEqual(['First question', `Reply in ${first.threadId}`]);
            expect(texts(second)).toEqual(['Second question', `Reply in ${second.threadId}`]);
            expect(transport.requests.map(it => it.threadId)).toEqual([
                first.threadId,
                second.threadId
            ]);
        });

        it('5. creates a thread in the store before its first run, and runs it under its id', async () => {
            const store = new LocalChatThreadStore({mintIds: true}),
                {model, transport} = setup({store});
            store.hold('createThreadAsync');

            const chatModel = model.newThread(),
                localId = chatModel.threadId,
                done = chatModel.sendAsync('Hello');
            await Promise.resolve();
            expect(transport.requests).toEqual([]);
            expect(chatModel.status).toBe('submitted');

            const [create] = store.heldCalls('createThreadAsync');
            expect(create.args[0]).toEqual({localId, title: 'Hello'});
            create.release();
            await done;

            const serverId = chatModel.threadId;
            expect(serverId).not.toBe(localId);
            expect(transport.requests[0].threadId).toBe(serverId);
            expect(model.selectedThreadId).toBe(serverId);
            expect(model.chatModel).toBe(chatModel);
            expect(ids(model.threads)).toEqual([serverId]);
        });

        it('5. creates each thread once, even when its first turn is retried', async () => {
            const store = new LocalChatThreadStore({mintIds: true}),
                {model} = setup({
                    store,
                    respond: (request, {attempt}) =>
                        attempt === 0 ? errorEvents('Overloaded') : textEvents('Recovered.')
                }),
                chatModel = model.newThread();

            await chatModel.sendAsync('Hello');
            expect(chatModel.status).toBe('error');
            await chatModel.retryAsync();

            expect(chatModel.lastMessage.text).toBe('Recovered.');
            expect(createCalls(store)).toHaveLength(1);
        });

        it('5. creates each thread once, even when its first turn is stopped mid-create', async () => {
            const store = new LocalChatThreadStore({mintIds: true}),
                {model, transport} = setup({store}),
                chatModel = model.newThread();
            store.hold('createThreadAsync');

            const stopped = chatModel.sendAsync('Hello');
            chatModel.stop();
            await stopped;
            store.heldCalls()[0].release();
            await chatModel.sendAsync('Hello again');

            expect(createCalls(store)).toHaveLength(1);
            expect(transport.requests.map(it => it.threadId)).toEqual([chatModel.threadId]);
            expect(store.getThread(chatModel.threadId)).not.toBeNull();
        });

        it('5. tries a failed create again, with the same local id', async () => {
            spyHandleException();
            const store = new LocalChatThreadStore({mintIds: true}),
                {model} = setup({store}),
                chatModel = model.newThread(),
                localId = chatModel.threadId;
            store.failNext('createThreadAsync');

            await chatModel.sendAsync('Hello');
            expect(chatModel.lastError.message).toBe('createThreadAsync failed.');
            await chatModel.retryAsync();

            expect(chatModel.status).toBe('ready');
            expect(createCalls(store).map(it => it.args[0].localId)).toEqual([localId, localId]);
            expect(store.getThread(chatModel.threadId)).not.toBeNull();
        });

        it('6. keeps drafts and run options in their own thread', async () => {
            const {model} = setup(),
                first = model.newThread(),
                firstId = first.threadId;
            first.composerModel.text = 'Draft for the first';
            first.runOptions = {scope: ['doc-1']};

            const second = model.newThread({runOptions: {scope: ['doc-2']}});
            expect(second.composerModel.text).toBe('');
            expect(second.runOptions).toEqual({scope: ['doc-2']});
            expect(first.isDestroyed).toBe(true);

            await model.selectThreadAsync(firstId);
            expect(model.chatModel.composerModel.text).toBe('Draft for the first');
            expect(model.chatModel.runOptions).toEqual({scope: ['doc-1']});
        });

        it('7. blocks sends in every other thread while one runs, if turns may not overlap', async () => {
            const turns = new TurnGates(),
                {model, transport} = setup({respond: turns.respond, allowConcurrentTurns: false}),
                first = model.newThread(),
                firstDone = first.sendAsync('First');

            const second = model.newThread();
            expect(second.sendBlockedReason).toBe(
                'Wait for the reply in another conversation to finish.'
            );
            await second.sendAsync('Second');
            expect(transport.requests).toHaveLength(1);

            turns.open(first.threadId);
            await firstDone;
            expect(second.sendBlockedReason).toBeNull();
        });

        it('8. opens a thread the store does not have as an empty thread', async () => {
            const {model} = setup();

            await model.selectThreadAsync('missing');

            expect(model.chatModel.isEmpty).toBe(true);
            expect(model.loadError).toBeNull();
            expect(model.chatModel.sendBlockedReason).toBeNull();
        });

        it('8. blocks sends only in a thread that failed to load, until it reloads', async () => {
            spyHandleException();
            const turns = new TurnGates(),
                {model, store} = setup({respond: turns.respond}),
                running = model.newThread(),
                done = running.sendAsync('Keep going');
            store.failNext('loadMessagesAsync', new Error('Server error'));

            await model.selectThreadAsync('t1');
            expect(model.loadError.message).toBe('Server error');
            expect(model.chatModel.sendBlockedReason).toBe(
                'The conversation did not load. Reload it to continue.'
            );
            expect(running.sendBlockedReason).toBeNull();

            await model.reloadThreadAsync();
            expect(model.loadError).toBeNull();
            expect(model.chatModel.sendBlockedReason).toBeNull();
            expect(texts(model.chatModel)).toEqual(['Hi', 'Hello! How can I help?']);
            turns.open(running.threadId);
            await done;
        });

        it('9. fails a turn that ends with no content', async () => {
            const {model} = setup({respond: () => []}),
                chatModel = model.newThread();

            await chatModel.sendAsync('Hello?');

            expect(chatModel.status).toBe('error');
            expect(chatModel.lastError).toBeInstanceOf(ChatRunError);
            expect(chatModel.lastError).toMatchObject({code: 'empty-response'});
        });
    });

    describe('open chats', () => {
        it('loads a selected thread, and closes the chat it leaves', async () => {
            const {model} = setup();

            await model.selectThreadAsync('t1');
            const first = model.chatModel;
            expect(texts(first)).toEqual(['Hi', 'Hello! How can I help?']);
            expect(first.threadId).toBe('t1');

            await model.selectThreadAsync('t2');
            expect(first.isDestroyed).toBe(true);
        });

        it('keeps a chat while its turn runs, and closes it when the turn ends', async () => {
            const turns = new TurnGates(),
                {model} = setup({respond: turns.respond}),
                chatModel = model.newThread(),
                done = chatModel.sendAsync('Long question');

            await model.selectThreadAsync('t1');
            expect(chatModel.isDestroyed).toBe(false);
            expect(model.runningThreadIds).toEqual([chatModel.threadId]);
            expect(model.threads[0]).toMatchObject({
                id: chatModel.threadId,
                title: 'Long question'
            });

            turns.open(chatModel.threadId);
            await done;
            expect(chatModel.isDestroyed).toBe(true);
            expect(model.runningThreadIds).toEqual([]);
        });

        it('marks a thread whose turn finished in the background until it is selected', async () => {
            const turns = new TurnGates(),
                {model} = setup({respond: turns.respond}),
                chatModel = model.newThread(),
                {threadId} = chatModel,
                done = chatModel.sendAsync('Long question');

            await model.selectThreadAsync('t1');
            turns.open(threadId);
            await done;
            expect(model.finishedAwayThreadIds).toEqual([threadId]);

            await model.selectThreadAsync(threadId);
            expect(model.finishedAwayThreadIds).toEqual([]);
        });

        it('does not mark a thread whose turn finished while it was selected', async () => {
            const {model} = setup(),
                chatModel = model.newThread();

            await chatModel.sendAsync('Hello');

            expect(model.finishedAwayThreadIds).toEqual([]);
        });

        it('keeps a chat whose turn waits for the user, and lists it as awaiting', async () => {
            const {model} = setup({
                    respond: () => toolCallEvents('delete_rows', {count: 3}),
                    chat: {
                        tools: [{name: 'delete_rows', needsApproval: true, execute: () => 'Done.'}]
                    }
                }),
                chatModel = model.newThread();
            await chatModel.sendAsync('Delete the rows');
            expect(chatModel.isAwaitingUser).toBe(true);

            await model.selectThreadAsync('t1');

            expect(chatModel.isDestroyed).toBe(false);
            expect(model.awaitingThreadIds).toEqual([chatModel.threadId]);
            expect(model.runningThreadIds).toEqual([]);
        });

        it('lists a background thread that pauses for approval as awaiting, not finished', async () => {
            let open: () => void;
            const gate = new Promise<void>(resolve => (open = resolve)),
                {model} = setup({
                    respond: async function* () {
                        await gate;
                        yield* toolCallEvents('delete_rows', {count: 3});
                    },
                    chat: {
                        tools: [{name: 'delete_rows', needsApproval: true, execute: () => 'Done.'}]
                    }
                }),
                chatModel = model.newThread(),
                sent = chatModel.sendAsync('Delete the rows');

            await model.selectThreadAsync('t1');
            open();
            await sent;

            expect(model.awaitingThreadIds).toEqual([chatModel.threadId]);
            expect(model.finishedAwayThreadIds).toEqual([]);
        });

        it('removes the saved drafts of deleted threads, open or closed', async () => {
            const {model} = setup({chat: {composer: {drafts: 'local'}}});
            await model.selectThreadAsync('t1');
            model.chatModel.composerModel.text = 'Draft for one';
            await model.selectThreadAsync('t2');
            model.chatModel.composerModel.text = 'Draft for two';
            expect(savedDraft('t1')).not.toBeNull();

            await model.deleteThreadsAsync(['t1', 't2']);

            expect(savedDraft('t1')).toBeNull();
            expect(savedDraft('t2')).toBeNull();
        });

        it('creates a new thread on the backend even when its chat starts with a greeting', async () => {
            const {model, store} = setup({
                    store: new LocalChatThreadStore({mintIds: true}),
                    chat: {initialMessages: [{role: 'assistant', content: 'Ask me anything.'}]}
                }),
                chatModel = model.newThread(),
                localId = chatModel.threadId;

            await chatModel.sendAsync('Hello');

            expect(createCalls(store)).toHaveLength(1);
            expect(chatModel.threadId).not.toBe(localId);
            expect(store.getThread(chatModel.threadId)).not.toBeNull();
        });

        it("deletes a thread's backend thread when the delete comes during its create", async () => {
            const {model, store} = setup({store: new LocalChatThreadStore({mintIds: true})}),
                chatModel = model.newThread(),
                localId = chatModel.threadId;
            store.hold('createThreadAsync');
            const sent = chatModel.sendAsync('Hello');
            await vi.waitFor(() => expect(store.heldCalls('createThreadAsync')).toHaveLength(1));

            const deleted = model.deleteThreadsAsync([localId]);
            store.heldCalls('createThreadAsync')[0].release();
            await Promise.all([sent, deleted]);
            await model.refreshAsync();

            const [deletedIds] = store.calls.find(it => it.method === 'deleteThreadsAsync').args;
            expect(deletedIds).toHaveLength(2);
            expect(deletedIds[0]).toBe(localId);
            expect(store.getThread(deletedIds[1])).toBeNull();
            expect(model.threads).toEqual([]);
        });

        it('stops and cancels a background turn when its thread is deleted', async () => {
            const turns = new TurnGates(),
                {model, transport} = setup({respond: turns.respond}),
                cancelAsync = vi.fn(async () => {});
            Object.assign(transport, {cancelAsync});
            const chatModel = model.newThread(),
                threadId = chatModel.threadId,
                sent = chatModel.sendAsync('Long question');
            await model.selectThreadAsync('t1');
            await vi.waitFor(() => expect(chatModel.status).toBe('submitted'));

            await model.deleteThreadsAsync([threadId]);
            turns.open(threadId);
            await sent;

            expect(chatModel.isDestroyed).toBe(true);
            expect(chatModel.lastMessage.status).toBe('aborted');
            expect(cancelAsync).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({threadId})
            );
        });

        it('stops the turns of its chats when it is destroyed', async () => {
            const turns = new TurnGates(),
                {model} = setup({respond: turns.respond}),
                chatModel = model.newThread(),
                sent = chatModel.sendAsync('Long question');

            model.destroy();
            turns.open(chatModel.threadId);
            await sent;

            expect(chatModel.isDestroyed).toBe(true);
        });

        it('includes runs the store reports in the running threads', async () => {
            const {model} = setup({
                store: new LocalChatThreadStore({threads: [{id: 't9', isRunning: true}]})
            });

            await model.loadAsync();

            expect(model.runningThreadIds).toEqual(['t9']);
        });

        it("re-keys a thread when its chat adopts the server's id", async () => {
            const {model} = setup({
                    respond: () => [runStarted('srv-9'), textEvents('Hi there.')]
                }),
                chatModel = model.newThread(),
                localId = chatModel.threadId;

            await chatModel.sendAsync('Hello');

            expect(chatModel.threadId).toBe('srv-9');
            expect(model.selectedThreadId).toBe('srv-9');
            expect(model.chatModel).toBe(chatModel);
            expect(ids(model.threads)).toEqual(['srv-9']);
            expect(ids(model.threads)).not.toContain(localId);
        });

        it('treats a cleared chat as a new thread, and leaves the old one in the list', async () => {
            const {model} = setup();
            await model.loadAsync();
            await model.selectThreadAsync('t1');
            const {chatModel} = model;

            chatModel.clear();

            expect(model.selectedThreadId).toBe(chatModel.threadId);
            expect(model.selectedThreadId).not.toBe('t1');
            expect(model.selectedSummary).toBeNull();
            expect(ids(model.threads)).toEqual(['t1', 't2', 't3']);
        });

        it('refreshes the list after a turn ends in the background', async () => {
            vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
            const turns = new TurnGates(),
                {model, store} = setup({
                    respond: (request, context) => {
                        store.saveThread({id: request.threadId, title: 'Titled by the server'});
                        return turns.respond(request, context);
                    }
                });
            await model.loadAsync();
            const chatModel = model.newThread(),
                done = chatModel.sendAsync('What changed?');
            await model.selectThreadAsync('t1');
            expect(model.threads[0].title).toBe('What changed?');

            turns.open(chatModel.threadId);
            await done;
            await vi.advanceTimersByTimeAsync(1000);

            expect(model.threads[0]).toMatchObject({
                id: chatModel.threadId,
                title: 'Titled by the server'
            });
            expect(listCalls(store)).toHaveLength(2);
        });
    });

    describe('optimistic changes', () => {
        it('renames at once, and rolls back with a toast if the store fails', async () => {
            const handleException = spyHandleException(),
                {model, store} = setup();
            await model.loadAsync();
            store.hold('renameThreadAsync');

            const done = model.renameThreadAsync('t1', '  Budget, final  ');
            expect(model.threads[0].title).toBe('Budget, final');
            store.heldCalls()[0].fail(new Error('Server down'));
            await done;

            expect(model.threads[0].title).toBe('Budget review');
            expect(handleException).toHaveBeenCalledWith(expect.any(Error), {
                message: 'The conversation was not renamed.',
                alertType: 'toast'
            });
        });

        it('keeps a newer rename when an older one fails', async () => {
            spyHandleException();
            const {model, store} = setup();
            await model.loadAsync();
            store.hold('renameThreadAsync');

            const older = model.renameThreadAsync('t1', 'Older'),
                newer = model.renameThreadAsync('t1', 'Newer');
            const [olderCall, newerCall] = store.heldCalls();
            newerCall.release();
            await newer;
            olderCall.fail();
            await older;

            expect(model.threads[0].title).toBe('Newer');
        });

        it('deletes at once, and restores the threads with a toast if the store fails', async () => {
            const handleException = spyHandleException(),
                {model, store} = setup();
            await model.loadAsync();
            await model.selectThreadAsync('t1');
            const deletedChat = model.chatModel;
            store.hold('deleteThreadsAsync');

            const done = model.deleteThreadsAsync(['t1', 't2']);
            expect(ids(model.threads)).toEqual(['t3']);
            expect(deletedChat.isDestroyed).toBe(true);
            expect(model.chatModel.isEmpty).toBe(true);
            store.heldCalls()[0].fail(new Error('Server down'));
            await done;

            expect(ids(model.threads)).toEqual(['t1', 't2', 't3']);
            expect(handleException).toHaveBeenCalledWith(expect.any(Error), {
                message: 'The conversations were not deleted.',
                alertType: 'toast'
            });
        });
    });

    describe('history', () => {
        it("applies only the newest load of a thread's history", async () => {
            const {model, store} = setup();
            store.hold('loadMessagesAsync');
            const firstLoad = model.selectThreadAsync('t1');
            store.saveThread({
                id: 't1',
                messages: [...THREADS[0].messages, {role: 'user', content: 'Are you there?'}]
            });

            const reload = model.reloadThreadAsync();
            const [stale, fresh] = store.heldCalls();
            fresh.release();
            await reload;
            stale.release();
            await firstLoad;

            expect(texts(model.chatModel)).toEqual([
                'Hi',
                'Hello! How can I help?',
                'Are you there?'
            ]);
        });

        it('blocks sends while the history loads', async () => {
            const {model, store} = setup();
            store.hold('loadMessagesAsync');

            const load = model.selectThreadAsync('t1');
            expect(model.chatModel.sendBlockedReason).toBe('Wait for the conversation to load.');
            store.heldCalls()[0].release();
            await load;

            expect(model.chatModel.sendBlockedReason).toBeNull();
        });
    });

    describe('status and run options', () => {
        it('reloads a thread to refresh the status of a run its chat lost sight of', async () => {
            const {model, store} = setup(),
                load = vi.spyOn(store, 'loadMessagesAsync');
            await model.selectThreadAsync('t1');

            expect(model.chatModel.canRefreshStatus).toBe(true);
            await model.chatModel.refreshStatusAsync();

            expect(load).toHaveBeenCalledTimes(2);
            expect(load.mock.calls[1][0]).toMatchObject({threadId: 't1'});
        });

        it('opens a thread with the run options of its last question', async () => {
            const {model} = setup({
                store: new LocalChatThreadStore({
                    threads: [
                        {
                            id: 't9',
                            title: 'Escrow',
                            lastActivityAt: NOW,
                            messages: [
                                {
                                    id: 'u1',
                                    role: 'user',
                                    content: 'Escrow rules?',
                                    metadata: {runOptions: {documentIds: ['d1']}}
                                },
                                {id: 'a1', role: 'assistant', content: 'They say...'}
                            ]
                        }
                    ]
                })
            });

            await model.selectThreadAsync('t9');

            expect(model.chatModel.runOptions).toEqual({documentIds: ['d1']});
        });
    });

    describe('feedback', () => {
        it("gives each chat the store's feedback submitter", async () => {
            const {model, store} = setup();
            await model.selectThreadAsync('t1');

            await model.chatModel.submitFeedbackAsync('t1-a1', 'positive');

            expect(store.calls.find(it => it.method === 'submitFeedbackAsync').args[0]).toEqual({
                threadId: 't1',
                messageId: 't1-a1',
                serverId: null,
                runId: null,
                rating: 'positive',
                comment: null,
                reasons: null
            });
            expect(store.getThread('t1').messages[1].metadata.feedback).toEqual({
                rating: 'positive'
            });
        });

        it("leaves a chat's own feedback submitter in place", async () => {
            const submitAsync = vi.fn(async () => {}),
                {model, store} = setup({chat: {feedback: {submitAsync}}});
            await model.selectThreadAsync('t1');

            await model.chatModel.submitFeedbackAsync('t1-a1', 'negative');

            expect(submitAsync).toHaveBeenCalledOnce();
            expect(store.calls.map(it => it.method)).not.toContain('submitFeedbackAsync');
        });
    });
});

//------------------
// Helpers
//------------------
const NOW = Date.now();

const THREADS: LocalChatThread[] = [
    {
        id: 't1',
        title: 'Budget review',
        lastActivityAt: NOW - 1000,
        messages: [
            {id: 't1-u1', role: 'user', content: 'Hi'},
            {id: 't1-a1', role: 'assistant', content: 'Hello! How can I help?'}
        ]
    },
    {
        id: 't2',
        title: 'Travel plans',
        lastActivityAt: NOW - 2000,
        messages: [
            {id: 't2-u1', role: 'user', content: 'Plan a trip'},
            {id: 't2-a1', role: 'assistant', content: 'Where to?'}
        ]
    },
    {id: 't3', title: 'Q3 forecast', lastActivityAt: NOW - 3000, messages: []}
];

type Respond = (
    request: ChatRunRequest,
    context: ScriptedRequestContext
) => ScriptedResponse | Promise<ScriptedResponse>;

interface SetupConfig extends Partial<Omit<ChatThreadsConfig, 'createChatModel' | 'store'>> {
    store?: LocalChatThreadStore;
    respond?: Respond;
    chat?: Partial<ChatModelConfig>;
}

function setup({
    store = new LocalChatThreadStore({threads: THREADS}),
    respond = request => textEvents(`Reply in ${request.threadId}`),
    chat = {},
    ...config
}: SetupConfig = {}) {
    const transport = new ScriptedChatTransport({respond, delayMs: 0}),
        model = new ChatThreadsModel({
            store,
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server', ...chat}),
            ...config
        });
    onTestFinished(() => model.destroy());
    return {model, store, transport};
}

/** Responses that wait, by thread, until the test opens them. */
class TurnGates {
    private gates = new Map<string, {promise: Promise<void>; open: () => void}>();

    respond: Respond = request => this.gated(request.threadId);

    open(threadId: string) {
        this.gate(threadId).open();
    }

    private gate(threadId: string) {
        if (!this.gates.has(threadId)) {
            let open: () => void;
            const promise = new Promise<void>(resolve => (open = resolve));
            this.gates.set(threadId, {promise, open});
        }
        return this.gates.get(threadId);
    }

    private async *gated(threadId: string): AsyncGenerator<ChatEvent> {
        await this.gate(threadId).promise;
        yield* textEvents(`Reply in ${threadId}`);
    }
}

function runStarted(threadId: string): ChatEvent {
    return {type: 'RUN_STARTED', threadId, runId: 'run-1'};
}

function savedDraft(threadId: string) {
    return XH.localStorageService.get(`xhChat.draft.${threadId}`, null);
}

function ids(threads: {id: string}[]): string[] {
    return threads.map(it => it.id);
}

function texts(chatModel: ChatModel): string[] {
    return chatModel.messages.map(it => it.text);
}

function listCalls(store: LocalChatThreadStore) {
    return store.calls.filter(it => it.method === 'listThreadsAsync').map(it => it.args[0]);
}

function createCalls(store: LocalChatThreadStore) {
    return store.calls.filter(it => it.method === 'createThreadAsync');
}

function spyHandleException() {
    const ret = vi.spyOn(XH, 'handleException').mockImplementation(() => {});
    onTestFinished(() => ret.mockRestore());
    return ret;
}
