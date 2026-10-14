import {describe, expect, it} from 'vitest';
import {LocalChatThreadStore} from './LocalChatThreadStore';

/**
 * The in-memory thread store that tests and demos run against. It must answer as a real backend
 * does - in pages, with 404s for missing threads and idempotent creates - and give tests exact
 * control over when each call completes.
 */
describe('LocalChatThreadStore', () => {
    it('lists threads most recent first, a page at a time, with search', async () => {
        const store = createStore();

        const first = await store.listThreadsAsync({limit: 2}),
            second = await store.listThreadsAsync({limit: 2, cursor: first.nextCursor}),
            found = await store.listThreadsAsync({search: 'TRAV'});

        expect(first.threads.map(it => it.id)).toEqual(['t1', 't2']);
        expect(second).toEqual({threads: [expect.objectContaining({id: 't3'})], nextCursor: null});
        expect(found.threads.map(it => it.id)).toEqual(['t2']);
        expect(first.threads[0]).not.toHaveProperty('messages');
    });

    it('loads history newest first, a page at a time, and 404s for a missing thread', async () => {
        const store = createStore();

        const newest = await store.loadMessagesAsync({threadId: 't1', limit: 1}),
            older = await store.loadMessagesAsync({threadId: 't1', cursor: newest.nextCursor});

        expect(newest.messages.map(it => it.content)).toEqual(['Hello!']);
        expect(older).toEqual({
            messages: [expect.objectContaining({content: 'Hi'})],
            nextCursor: null
        });
        await expect(store.loadMessagesAsync({threadId: 'nope'})).rejects.toMatchObject({
            httpStatus: 404
        });
    });

    it('creates each thread once per local id, and titles a saved thread from its first message', async () => {
        const store = new LocalChatThreadStore({mintIds: true});

        const first = await store.createThreadAsync({localId: 'local-1', title: 'Hello'}),
            again = await store.createThreadAsync({localId: 'local-1'});
        store.saveThread({
            id: 'saved',
            messages: [{role: 'user', content: 'Plan a  trip\nto Rome'}]
        });

        expect(again.id).toBe(first.id);
        expect(first.id).not.toBe('local-1');
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

        store.failNext('pinThreadAsync', new Error('Down'));
        await expect(store.pinThreadAsync('t1', true)).rejects.toThrow('Down');
        await store.pinThreadAsync('t1', true);
        expect(store.getThread('t1').pinned).toBe(true);
    });

    it('leaves out the optional methods it is told to', () => {
        const store = new LocalChatThreadStore({
            omit: ['renameThreadAsync', 'submitFeedbackAsync']
        });

        expect(store.renameThreadAsync).toBeUndefined();
        expect(store.submitFeedbackAsync).toBeUndefined();
        expect(store.createThreadAsync).toBeUndefined();
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
