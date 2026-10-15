import {act, fireEvent, render, screen} from '@testing-library/react';
import {GridModel} from '@xh/hoist/cmp/grid';
import {div} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {type ChatAssistantConfig, ChatAssistantModel, gridTools} from '../../../assist';
import {
    type ChatEvent,
    ScriptedChatTransport,
    scriptedDelay,
    textEvents,
    toolCallEvents
} from '../../../transport';
import {chatAssistantButton} from './ChatAssistantButton';
import {chatAssistantContainer} from './ChatAssistantContainer';
import {chatDataBoundaryLine} from './ChatDataBoundaryLine';

/**
 * The helper's desktop parts: a button that stays out of the way until wanted, a container that
 * docks the helper inside a wide component and leaves a narrow one to the popover, a shortcut
 * scoped to the component, Escape that closes the helper last, and an Undo that retires when the
 * user changes the component by hand.
 */
describe('Component helper', () => {
    beforeAll(async () => {
        await initTestAppAsync();
        Element.prototype.scrollTo ??= () => {};
    });

    // jsdom has no layout, and so no ResizeObserver. The setup unstubs globals after each test.
    beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));

    describe('button', () => {
        it('does not render without a backend', () => {
            const model = new ChatAssistantModel({groups: gridTools(createGrid())});
            onTestFinished(() => model.destroy());
            render(chatAssistantButton({model}));

            expect(document.querySelector('.xh-chat-hbtn')).toBeNull();
        });

        it('names the component, and says when it is open', () => {
            const model = createModel();
            render(chatAssistantButton({model}));
            const btn = screen.getByRole('button', {name: 'Ask about Positions grid'});
            expect(btn.getAttribute('aria-expanded')).toBe('false');

            fireEvent.click(btn);

            expect(model.isOpen).toBe(true);
            expect(btn.getAttribute('aria-expanded')).toBe('true');
        });

        it('shows a badge while closed, with its state in the name', async () => {
            const model = createModel({}, [textEvents('Done.')]);
            render(chatAssistantButton({model}));

            await act(() => model.chatModel.sendAsync('Hello'));

            expect(document.querySelector('.xh-chat-hbadge--ready')).toBeTruthy();
            expect(screen.getByRole('button', {name: 'Ask about Positions grid, new reply'}));

            act(() => model.open());
            expect(document.querySelector('.xh-chat-hbadge')).toBeNull();
        });

        it('shows "Ask" beside the icon when labelled', () => {
            render(chatAssistantButton({model: createModel(), labelled: true}));
            expect(document.querySelector('.xh-chat-hbtn')?.textContent).toBe('Ask');
        });
    });

    describe('container', () => {
        it('docks the open helper inside a component 740 px or wider', () => {
            const model = createModel();
            renderComponent(model);
            act(() => {
                model.setComponentWidth(900);
                model.open();
            });

            const container = document.querySelector('.xh-chat-assistant-container');
            expect(container.querySelector('.xh-chat-helper')).toBeTruthy();
            expect(container.querySelector('.xh-chat-helper').getAttribute('aria-label')).toBe(
                'Assistant for Positions grid'
            );
            expect(screen.getByText('Sees column names and filters, not row data')).toBeTruthy();
        });

        it('opens a narrower component helper as a popover from its button', async () => {
            const model = createModel();
            renderComponent(model);
            act(() => {
                model.setComponentWidth(600);
                model.open();
            });

            const helper = await screen.findByRole('complementary', {
                name: 'Assistant for Positions grid'
            });
            expect(helper.closest('.xh-chat-assistant-container')).toBeNull();
            expect(helper.classList.contains('xh-chat-helper--popover')).toBe(true);
        });

        it('opens and closes the helper with Ctrl+I, from inside the component', () => {
            const model = createModel();
            renderComponent(model);
            const content = document.querySelector('.test-grid-body');

            fireEvent.keyDown(content, CTRL_I);
            expect(model.isOpen).toBe(true);

            fireEvent.keyDown(content, CTRL_I);
            expect(model.isOpen).toBe(false);
        });

        it('shows the intro and suggestions of an empty helper', () => {
            const model = createModel();
            renderComponent(model);
            act(() => model.open());

            expect(
                screen.getByText("I can change this grid's layout, or explain any of its options.")
            );
            expect(document.querySelectorAll('.xh-chat-suggestions__card').length).toBeGreaterThan(
                0
            );
        });
    });

    describe('keyboard', () => {
        it('stops a running reply on Escape, then closes the helper on the next', async () => {
            const model = createModel({}, [[scriptedDelay(5_000), textEvents('Late.')]]);
            renderComponent(model);
            act(() => model.open());
            const helper = document.querySelector('.xh-chat-helper');

            act(() => void model.chatModel.sendAsync('Hello'));
            await vi.waitFor(() => expect(model.chatModel.isBusy).toBe(true));

            fireEvent.keyDown(helper.querySelector('.xh-chat-helper__header'), {key: 'Escape'});
            await vi.waitFor(() => expect(model.chatModel.isBusy).toBe(false));
            expect(model.isOpen).toBe(true);

            fireEvent.keyDown(helper.querySelector('.xh-chat-helper__header'), {key: 'Escape'});
            expect(model.isOpen).toBe(false);
        });
    });

    describe('undo', () => {
        it('replaces Undo with the reason once the component changes by hand', async () => {
            const gridModel = createGrid(),
                model = createModel({groups: gridTools(gridModel, {title: 'Positions grid'})}, [
                    toolCallEvents('group_grid', {columns: ['region']}),
                    textEvents('Grouped by region.')
                ]);
            renderComponent(model);
            act(() => model.open());

            await act(() => model.chatModel.sendAsync('Group by region'));
            expect(screen.getByRole('button', {name: 'Undo changes'})).toBeTruthy();

            act(() => gridModel.setSortBy('region'));

            expect(screen.queryByRole('button', {name: 'Undo changes'})).toBeNull();
            expect(
                screen.getByText(
                    "Positions grid has changed since, so these changes can't be undone."
                )
            ).toBeTruthy();
        });

        it('shows each change as a line, with Show', async () => {
            const model = createModel({}, [
                toolCallEvents('group_grid', {columns: ['region']}),
                textEvents('Grouped.')
            ]);
            renderComponent(model);
            act(() => model.open());

            await act(() => model.chatModel.sendAsync('Group by region'));

            const line = document.querySelector('.xh-chat-hline');
            expect(line.textContent).toContain('Grouped by Region.');
            expect(line.querySelector('.xh-chat-hline__show')).toBeTruthy();
        });
    });

    describe('data boundary line', () => {
        it('lists what is and is not shared on click', async () => {
            render(
                chatDataBoundaryLine({
                    boundary: {
                        text: 'Sees column names only',
                        shared: ['Column names'],
                        notShared: ['Row values'],
                        isLimitedByAdmin: true
                    }
                })
            );
            const line = screen.getByRole('button', {
                name: 'Sees column names only, limited by your administrator'
            });

            fireEvent.click(line);

            expect(await screen.findByText('Row values')).toBeTruthy();
            expect(line.getAttribute('aria-expanded')).toBe('true');
        });

        it('warns when a helper does not say what it sees', () => {
            vi.spyOn(console, 'error').mockImplementation(() => null);
            render(chatDataBoundaryLine({boundary: null}));

            expect(screen.getByText('This helper does not say what it can see.')).toBeTruthy();
            expect(console.error).toHaveBeenCalled();
        });
    });
});

//------------------
// Helpers
//------------------
const CTRL_I = {key: 'i', code: 'KeyI', keyCode: 73, which: 73, ctrlKey: true};

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

function createGrid(): GridModel {
    const ret = new GridModel({
        columns: [{field: 'name'}, {field: 'region'}, {field: {name: 'price', type: 'number'}}]
    });
    ret.loadData([
        {id: 1, name: 'Boston', region: 'AMER', price: 40},
        {id: 2, name: 'Tokyo', region: 'APAC', price: 120}
    ]);
    onTestFinished(() => ret.destroy());
    return ret;
}

function createModel(
    config: Partial<ChatAssistantConfig> = {},
    responses: Array<ChatEvent[] | Array<ChatEvent[] | ReturnType<typeof scriptedDelay>>> = []
): ChatAssistantModel {
    const ret = new ChatAssistantModel({
        groups: gridTools(createGrid(), {title: 'Positions grid'}),
        transport: new ScriptedChatTransport({responses: responses as any, delayMs: 0}),
        ...config
    });
    onTestFinished(() => ret.destroy());
    return ret;
}

/** A component with a helper: its header's button, and its body in the container. */
function renderComponent(model: ChatAssistantModel) {
    return render(
        div({
            items: [
                chatAssistantButton({model}),
                chatAssistantContainer({
                    model,
                    item: div({className: 'test-grid-body', tabIndex: 0, item: 'Grid'})
                })
            ]
        })
    );
}
