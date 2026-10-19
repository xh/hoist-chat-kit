import {describe, expect, it} from 'vitest';
import {LocalChatThreadStore} from './LocalChatThreadStore';

/**
 * The in-memory thread store that the kit's specs run against. It must answer as a real backend
 * does - with 404s for missing threads - and give tests exact control over when each call
 * completes.
 */
describe('LocalChatThreadStore', () => {
    it('lists threads most recent first, with search', async () => {
        const store = createStore();

        const all = await store.listThreadsAsync({}),
            found = await store.listThreadsAsync({search: 'TRAV'});

        expect(all.threads.map(it => it.id)).toEqual(['t1', 't2', 't3']);
        expect(found.threads.map(it => it.id)).toEqual(['t2']);
        expect(all.threads[0]).not.toHaveProperty('messages');
    });

    it('loads history oldest first, and 404s for a missing thread', async () => {
        const store = createStore();

        const history = await store.loadMessagesAsync({threadId: 't1'});

        expect(history.messages.map(it => it.content)).toEqual(['Hi', 'Hello!']);
        await expect(store.loadMessagesAsync({threadId: 'nope'})).rejects.toMatchObject({
            httpStatus: 404
        });
    });

    it('titles a saved thread from its first message', async () => {
        const store = new LocalChatThreadStore();

        store.saveThread({
            id: 'saved',
            messages: [{role: 'user', content: 'Plan a  trip\nto Rome'}]
        });

        expect(store.getThread('saved').title).toBe('Plan a trip to Rome');
    });

    it('holds calls until released, answering reads with the data as it was when called', async () => {
        const store = createStore();
        store.hold('listThreadsAsync');

        const list = store.listThreadsAsync({});
        await store.deleteThreadsAsync(['t1', 'missing']);
        const [held] = store.heldCalls('listThreadsAsync');
        held.release();

        expect((await list).threads.map(it => it.id)).toEqual(['t1', 't2', 't3']);
        expect(store.heldCalls()).toEqual([]);
        expect(store.getThread('t1')).toBeNull();
    });

    it('applies a held write only when released, and fails the next call on request', async () => {
        const store = createStore();
        store.hold('renameThreadAsync');

        const rename = store.renameThreadAsync('t1', 'Renamed');
        expect(store.getThread('t1').title).toBe('Budget review');
        store.heldCalls()[0].release();
        await rename;
        expect(store.getThread('t1').title).toBe('Renamed');

        store.hold('renameThreadAsync', false);
        store.failNext('renameThreadAsync', new Error('Down'));
        await expect(store.renameThreadAsync('t1', 'Again')).rejects.toThrow('Down');
        await store.renameThreadAsync('t1', 'Again');
        expect(store.getThread('t1').title).toBe('Again');
    });

    it('leaves out the optional methods it is told to', () => {
        const store = new LocalChatThreadStore({
            omit: ['renameThreadAsync', 'submitFeedbackAsync']
        });

        expect(store.renameThreadAsync).toBeUndefined();
        expect(store.submitFeedbackAsync).toBeUndefined();
        expect(store.deleteThreadsAsync).toBeDefined();
    });
});

function createStore(): LocalChatThreadStore {
    const now = Date.now();
    return new LocalChatThreadStore({
        threads: [
            {
                id: 't1',
                title: 'Budget review',
                lastActivityAt: now - 1000,
                messages: [
                    {role: 'user', content: 'Hi'},
                    {role: 'assistant', content: 'Hello!'}
                ]
            },
            {id: 't2', title: 'Travel plans', lastActivityAt: now - 2000},
            {id: 't3', title: 'Q3 forecast', lastActivityAt: now - 3000}
        ]
    });
}
