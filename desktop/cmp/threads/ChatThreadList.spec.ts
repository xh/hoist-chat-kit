import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {
    type LocalChatThread,
    LocalChatThreadStore
} from '../../../test/support/LocalChatThreadStore';
import {ChatThreadsModel} from '../../../threads';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatThreadList} from './ChatThreadList';

/**
 * The thread list's contract. Apps rely on it to show a user's threads grouped by recency, open
 * the one clicked, rename and delete in place - always confirming a delete - and show the
 * actions only where the store supports them. It also marks threads that run, wait for the user,
 * or finished while the user was away.
 */
describe('ChatThreadList', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver. The setup unstubs globals after each test.
    beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));

    it('groups the threads by recency', async () => {
        await renderList();

        expect(groupLabels()).toEqual([
            'Today',
            'Yesterday',
            'Previous 7 days',
            'Previous 30 days'
        ]);
        expect(rowTitles()).toEqual(['Budget review', 'Travel', 'Old notes', 'Old plan']);
    });

    it('opens a thread on click, and marks it selected', async () => {
        const {model} = await renderList();

        fireEvent.click(row('Travel'));
        await act(() => wait());

        expect(model.selectedThreadId).toBe('t2');
        expect(row('Travel').getAttribute('aria-selected')).toBe('true');
        expect(row('Travel').hasAttribute('aria-current')).toBe(false);
        expect(row('Budget review').getAttribute('aria-selected')).toBe('false');
    });

    it('is a tree grid whose rows hold their buttons in a cell, never in the row itself', async () => {
        await renderList();

        const grid = screen.getByRole('treegrid', {name: 'Threads'}),
            travel = row('Travel');
        expect(grid.contains(travel)).toBe(true);
        expect(travel.getAttribute('aria-level')).toBe('1');
        within(travel)
            .getAllByRole('button')
            .forEach(it => expect(it.closest('[role="gridcell"]')).toBeTruthy());
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(screen.queryAllByRole('option')).toHaveLength(0);
    });

    it('moves between rows with the arrow keys, and opens one with Enter', async () => {
        const {model} = await renderList();

        row('Budget review').focus();
        fireEvent.keyDown(row('Budget review'), {key: 'ArrowDown'});
        expect(document.activeElement).toBe(row('Travel'));

        fireEvent.keyDown(row('Travel'), {key: 'Enter'});
        await act(() => wait());
        expect(model.selectedThreadId).toBe('t2');
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

    it('deletes a thread with Backspace on its row, as a Mac laptop sends', async () => {
        const {model} = await renderList(),
            confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(true);
        onTestFinished(() => confirm.mockRestore());

        fireEvent.keyDown(row('Travel'), {key: 'Backspace'});
        await act(() => wait());
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(model.threads.map(it => it.id)).not.toContain('t2');
    });

    it('leaves Backspace alone on a row button', async () => {
        await renderList();
        const confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(true);
        onTestFinished(() => confirm.mockRestore());

        fireEvent.keyDown(within(row('Travel')).getByRole('button', {name: 'More'}), {
            key: 'Backspace'
        });
        await act(() => wait());
        expect(confirm).not.toHaveBeenCalled();
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

    it('shows Rename only if the store supports it', async () => {
        const {model} = await renderList({
            store: new LocalChatThreadStore({
                threads: THREADS,
                omit: ['renameThreadAsync', 'deleteThreadsAsync']
            })
        });
        const travel = within(row('Travel'));

        expect(travel.queryByRole('button', {name: 'Rename'})).toBeNull();
        expect(travel.getByRole('button', {name: 'More'})).toBeTruthy();

        fireEvent.keyDown(row('Travel'), {key: 'F2'});
        expect(screen.queryByLabelText('Rename thread')).toBeNull();
        expect(model.canDelete).toBe(false);
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

    it('starts a new thread from New Chat', async () => {
        const {model} = await renderList();
        await act(() => model.selectThreadAsync('t1'));

        fireEvent.click(screen.getByRole('button', {name: 'New Chat'}));

        expect(model.selectedThreadId).not.toBe('t1');
        expect(model.chatModel.isEmpty).toBe(true);
    });

    it('marks threads that run, wait for the user, have a new reply or were interrupted', async () => {
        const store = new LocalChatThreadStore({
                threads: [
                    thread('a', 'Running', {isRunning: true}),
                    thread('b', 'Awaiting'),
                    thread('c', 'Finished away'),
                    thread('d', 'Cut short', {lastRunEnd: 'interrupted'}),
                    thread('e', 'Plain')
                ]
            }),
            model = createModel(store);
        vi.spyOn(model, 'awaitingThreadIds', 'get').mockReturnValue(['b']);
        vi.spyOn(model, 'finishedAwayThreadIds', 'get').mockReturnValue(['c']);
        await model.loadAsync();
        render(chatThreadList({model}));

        expect(row('Running').getAttribute('aria-label')).toBe('Running, working');
        expect(within(row('Running')).getByText('Working')).toBeTruthy();
        expect(row('Awaiting').getAttribute('aria-label')).toBe('Awaiting, waiting for you');
        expect(row('Finished away').getAttribute('aria-label')).toBe('Finished away, new reply');
        expect(row('Cut short').getAttribute('aria-label')).toBe(
            'Cut short, last reply interrupted'
        );
        expect(row('Plain').getAttribute('aria-label')).toMatch(/^Plain, \d\d:\d\d$/);
    });

    it('hides the search input with enableSearch false', async () => {
        const model = createModel(new LocalChatThreadStore({threads: THREADS}));
        await model.loadAsync();
        render(chatThreadList({model, enableSearch: false}));

        expect(screen.queryByLabelText('Search threads')).toBeNull();
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
    {id: 't4', title: 'Old plan', lastActivityAt: NOW - 10 * DAY}
];

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

async function renderList({
    store = new LocalChatThreadStore({threads: THREADS})
}: {store?: LocalChatThreadStore} = {}) {
    const model = createModel(store);
    await model.loadAsync();
    render(chatThreadList({model}));
    return {model, store};
}

function createModel(store: LocalChatThreadStore): ChatThreadsModel {
    const transport = new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0}),
        model = new ChatThreadsModel({
            store,
            createChatModel: ({threadId}) =>
                new ChatModel({transport, threadId, historyMode: 'server'})
        });
    onTestFinished(() => model.destroy());
    return model;
}

function thread(id: string, title: string, rest: Partial<LocalChatThread> = {}) {
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
        .getAllByRole('row')
        .find(it => it.querySelector('.xh-chat-thread-list__title')?.textContent === title);
}

function rowTitles(): string[] {
    return screen
        .queryAllByRole('row')
        .map(it => it.querySelector('.xh-chat-thread-list__title')?.textContent);
}

function groupLabels(): string[] {
    return screen.getAllByRole('rowgroup').map(it => it.getAttribute('aria-label'));
}

function titleOf(model: ChatThreadsModel, threadId: string): string {
    return model.threads.find(it => it.id === threadId)?.title;
}
