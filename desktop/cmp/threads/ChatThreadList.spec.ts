import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {HoistModel, XH} from '@xh/hoist/core';
import {observable, observableRef} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {
    type ChatThreadListHost,
    ChatThreadsModel,
    type ChatThreadSummary,
    type LocalChatThread,
    LocalChatThreadStore
} from '../../../threads';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatThreadList} from './ChatThreadList';

/**
 * The thread list's contract. Apps rely on it to show a user's threads grouped by recency, open
 * the one clicked, rename, pin and delete in place - always confirming a delete - and show the
 * actions only where the store supports them. It also marks threads that run, wait for the user,
 * or finished while the user was away.
 */
describe('ChatThreadList', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver. The setup unstubs globals after each test.
    beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));

    it('groups the threads by recency, with Pinned first', async () => {
        await renderList();

        expect(groupLabels()).toEqual(['Pinned', 'Today', 'Yesterday', 'Previous 7 days']);
        expect(rowTitles()).toEqual(['Pinned plan', 'Budget review', 'Travel', 'Old notes']);
    });

    it('opens a thread on click, and marks it selected', async () => {
        const {model} = await renderList();

        fireEvent.click(row('Travel'));
        await act(() => wait());

        expect(model.selectedThreadId).toBe('t2');
        expect(row('Travel').getAttribute('aria-selected')).toBe('true');
        expect(row('Travel').getAttribute('aria-current')).toBe('page');
        expect(row('Budget review').getAttribute('aria-selected')).toBe('false');
    });

    it('moves between rows with the arrow keys, and opens one with Enter', async () => {
        const {model} = await renderList();

        row('Pinned plan').focus();
        fireEvent.keyDown(row('Pinned plan'), {key: 'ArrowDown'});
        expect(document.activeElement).toBe(row('Budget review'));

        fireEvent.keyDown(row('Budget review'), {key: 'Enter'});
        await act(() => wait());
        expect(model.selectedThreadId).toBe('t1');
    });

    it('renames a thread in place, saving on Enter', async () => {
        const {model, store} = await renderList();

        fireEvent.click(within(row('Travel')).getByRole('button', {name: 'Rename'}));
        const input = screen.getByLabelText('Rename thread');
        fireEvent.change(input, {target: {value: 'Trip to Lisbon'}});
        fireEvent.keyDown(input, {key: 'Enter'});

        expect(titleOf(model, 't2')).toBe('Trip to Lisbon');
        await act(() => wait());
        expect(store.getThread('t2').title).toBe('Trip to Lisbon');
        expect(screen.queryByLabelText('Rename thread')).toBeNull();
    });

    it('starts a rename with F2, and keeps the old title on Escape', async () => {
        const {model, store} = await renderList();

        fireEvent.keyDown(row('Travel'), {key: 'F2'});
        const input = screen.getByLabelText('Rename thread');
        fireEvent.change(input, {target: {value: 'Something else'}});
        fireEvent.keyDown(input, {key: 'Escape'});
        await act(() => wait());

        expect(titleOf(model, 't2')).toBe('Travel');
        expect(store.calls.some(it => it.method === 'renameThreadAsync')).toBe(false);
        expect(screen.queryByLabelText('Rename thread')).toBeNull();
    });

    it('confirms before it deletes a thread', async () => {
        const {model} = await renderList(),
            confirm = vi.spyOn(XH, 'confirm').mockResolvedValueOnce(false);
        onTestFinished(() => confirm.mockRestore());

        fireEvent.keyDown(row('Travel'), {key: 'Delete'});
        await act(() => wait());
        expect(confirm).toHaveBeenCalledWith(expect.objectContaining({title: 'Delete thread?'}));
        expect(rowTitles()).toContain('Travel');

        confirm.mockResolvedValueOnce(true);
        fireEvent.keyDown(row('Travel'), {key: 'Delete'});
        await act(() => wait());
        expect(model.threads.map(it => it.id)).not.toContain('t2');
        expect(rowTitles()).not.toContain('Travel');
    });

    it('opens the next thread down when the open thread is deleted', async () => {
        const {model} = await renderList(),
            confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(true);
        onTestFinished(() => confirm.mockRestore());
        await act(() => model.selectThreadAsync('t1'));

        fireEvent.keyDown(row('Budget review'), {key: 'Delete'});
        await act(() => wait());

        expect(model.selectedThreadId).toBe('t2');
    });

    it('shows Pin and Rename only if the store supports them', async () => {
        const {model} = await renderList({
            store: new LocalChatThreadStore({
                threads: THREADS,
                omit: ['renameThreadAsync', 'pinThreadAsync', 'deleteThreadsAsync']
            })
        });
        const travel = within(row('Travel'));

        expect(travel.queryByRole('button', {name: 'Rename'})).toBeNull();
        expect(travel.queryByRole('button', {name: 'Pin'})).toBeNull();
        expect(travel.getByRole('button', {name: 'More'})).toBeTruthy();

        fireEvent.keyDown(row('Travel'), {key: 'F2'});
        expect(screen.queryByLabelText('Rename thread')).toBeNull();
        expect(model.canDelete).toBe(false);
    });

    it('pins a thread from its row', async () => {
        const {model} = await renderList();

        fireEvent.click(within(row('Travel')).getByRole('button', {name: 'Pin'}));
        await act(() => wait());

        expect(model.threads.find(it => it.id === 't2').pinned).toBe(true);
        expect(groupLabels()[0]).toBe('Pinned');
        expect(
            within(screen.getByRole('group', {name: 'Pinned'})).getByText('Travel')
        ).toBeTruthy();
    });

    it('binds the search input to the model, and clears it on Escape', async () => {
        const {model} = await renderList(),
            input = screen.getByLabelText('Search threads');

        fireEvent.change(input, {target: {value: 'bud'}});
        expect(model.search).toBe('bud');

        fireEvent.keyDown(input, {key: 'Escape'});
        expect(model.search).toBeNull();
    });

    it('lists search results in one group, and says when none match', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
        const {model} = await renderList();

        act(() => (model.search = 'budget'));
        await act(() => vi.advanceTimersByTimeAsync(350));
        expect(groupLabels()).toEqual(['1 result']);
        expect(rowTitles()).toEqual(['Budget review']);

        act(() => (model.search = 'zebra'));
        await act(() => vi.advanceTimersByTimeAsync(350));
        expect(screen.getByText("No threads match 'zebra'")).toBeTruthy();
    });

    it('says when there are no threads yet', async () => {
        await renderList({store: new LocalChatThreadStore()});

        expect(screen.getByText('No threads yet')).toBeTruthy();
    });

    it('shows a failed list load with Retry', async () => {
        const store = new LocalChatThreadStore({threads: THREADS});
        store.failNext('listThreadsAsync', new Error('The chat service returned 503.'));
        const {model} = await renderList({store});

        expect(within(screen.getByRole('alert')).getByText("Couldn't load threads")).toBeTruthy();
        fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
        await act(() => wait());

        expect(model.listError).toBeNull();
        expect(rowTitles()).toHaveLength(4);
    });

    it('loads more threads from the Load More button', async () => {
        const {model} = await renderList({pageSize: 2});
        expect(rowTitles()).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', {name: 'Load More'}));
        await act(() => wait());

        expect(rowTitles()).toHaveLength(4);
        expect(model.hasMoreThreads).toBe(false);
    });

    describe('with a host of its own', () => {
        it('marks threads that run, wait for the user, have a new reply or were interrupted', () => {
            const host = new TestHost({
                threads: [
                    summary('a', 'Running'),
                    summary('b', 'Awaiting'),
                    summary('c', 'Finished away'),
                    summary('d', 'Cut short', {lastRunEnd: 'interrupted'}),
                    summary('e', 'Plain')
                ],
                runningThreadIds: ['a'],
                awaitingThreadIds: ['b'],
                finishedAwayThreadIds: ['c']
            });
            renderHostList(host);

            expect(row('Running').getAttribute('aria-label')).toBe('Running, working');
            expect(within(row('Running')).getByText('Working')).toBeTruthy();
            expect(row('Awaiting').getAttribute('aria-label')).toBe('Awaiting, waiting for you');
            expect(row('Finished away').getAttribute('aria-label')).toBe(
                'Finished away, new reply'
            );
            expect(row('Cut short').getAttribute('aria-label')).toBe(
                'Cut short, last reply interrupted'
            );
            expect(row('Plain').getAttribute('aria-label')).toMatch(/^Plain, \d\d:\d\d$/);
        });

        it('hides the actions and the search the host leaves out', () => {
            renderHostList(new TestHost({threads: [summary('a', 'Only')]}));

            expect(within(row('Only')).queryByRole('button', {name: 'Rename'})).toBeNull();
            expect(within(row('Only')).queryByRole('button', {name: 'Pin'})).toBeNull();
            expect(screen.queryByLabelText('Search threads')).toBeNull();
        });

        it('calls the host to start a thread and to open one', () => {
            const host = new TestHost({threads: [summary('a', 'Only')]});
            renderHostList(host);

            fireEvent.click(screen.getByRole('button', {name: 'New Chat'}));
            fireEvent.click(row('Only'));

            expect(host.newThread).toHaveBeenCalledTimes(1);
            expect(host.selectThreadAsync).toHaveBeenCalledWith('a');
        });
    });
});

//------------------
// Helpers
//------------------
const DAY = 24 * 60 * 60 * 1000,
    NOW = Date.now();

const THREADS: LocalChatThread[] = [
    {id: 't1', title: 'Budget review', lastActivityAt: NOW, messages: textMessages('Hi')},
    {id: 't2', title: 'Travel', lastActivityAt: NOW - DAY, messages: textMessages('Hello')},
    {id: 't3', title: 'Old notes', lastActivityAt: NOW - 3 * DAY},
    {id: 't4', title: 'Pinned plan', lastActivityAt: NOW - 10 * DAY, pinned: true}
];

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

async function renderList({
    store = new LocalChatThreadStore({threads: THREADS}),
    pageSize = 50
}: {store?: LocalChatThreadStore; pageSize?: number} = {}) {
    const transport = new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        model = new ChatThreadsModel({
            store,
            pageSize,
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server'})
        });
    onTestFinished(() => model.destroy());

    await model.loadAsync();
    render(chatThreadList({model}));
    return {model, store};
}

/** A host of an app's own - a plain HoistModel with only the members it needs. */
class TestHost extends HoistModel implements ChatThreadListHost {
    @observableRef accessor threads: ChatThreadSummary[];
    @observable accessor selectedThreadId: string = null;
    readonly runningThreadIds: string[];
    readonly awaitingThreadIds: string[];
    readonly finishedAwayThreadIds: string[];

    newThread = vi.fn();
    selectThreadAsync = vi.fn(async () => {});

    constructor(config: Partial<ChatThreadListHost>) {
        super();
        this.threads = config.threads ?? [];
        this.runningThreadIds = config.runningThreadIds ?? [];
        this.awaitingThreadIds = config.awaitingThreadIds ?? [];
        this.finishedAwayThreadIds = config.finishedAwayThreadIds ?? [];
    }
}

function renderHostList(host: TestHost) {
    onTestFinished(() => host.destroy());
    render(chatThreadList({model: host}));
}

function summary(id: string, title: string, rest: Partial<ChatThreadSummary> = {}) {
    return {id, title, lastActivityAt: NOW, ...rest};
}

function textMessages(text: string) {
    return [
        {role: 'user' as const, content: text},
        {role: 'assistant' as const, content: 'Reply'}
    ];
}

function row(title: string): HTMLElement {
    return screen
        .getAllByRole('option')
        .find(it => it.querySelector('.xh-chat-thread-list__title')?.textContent === title);
}

function rowTitles(): string[] {
    return screen
        .queryAllByRole('option')
        .map(it => it.querySelector('.xh-chat-thread-list__title')?.textContent);
}

function groupLabels(): string[] {
    return screen
        .getAllByRole('group')
        .map(it => it.querySelector('.xh-chat-thread-list__group-label').textContent);
}

function titleOf(model: ChatThreadsModel, threadId: string): string {
    return model.threads.find(it => it.id === threadId)?.title;
}
