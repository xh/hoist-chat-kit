import {act, render, screen} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {chatAnnouncer, ChatModel, type ChatModelConfig} from '../../../core';
import {
    type ChatEvent,
    type ChatRunRequest,
    type ChatTransport,
    ScriptedChatTransport,
    textEvents,
    toolCallEvents
} from '../../../transport';
import {chatMessageList} from './ChatMessageList';

/**
 * The live cues of a reply in the message list, and what screen readers hear. Users rely on the
 * header saying what the reply is doing - and that it has gone quiet - and on hearing each finished
 * reply once, never its tokens.
 */
describe('ChatMessageList live cues', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
        chatAnnouncer.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('is a silent log, beside the hidden polite and assertive regions that speak', () => {
        const {container} = render(chatMessageList({model: createModel({})}));

        const log = screen.getByRole('log');
        expect(log.getAttribute('aria-live')).toBe('off');
        expect(container.querySelector('.xh-chat-announcer [aria-live="polite"]')).toBeTruthy();
        expect(container.querySelector('.xh-chat-announcer [aria-live="assertive"]')).toBeTruthy();
    });

    it('says the reply is thinking, then writing with a caret, which goes once it is done', async () => {
        const {transport, push, end} = manualTransport(),
            model = createModel({transport}),
            {container} = render(chatMessageList({model}));

        let sending: Promise<void>;
        await act(async () => {
            sending = model.sendAsync('Hi');
        });
        expect(header(container).textContent).toContain('Thinking');

        await act(async () => {
            push(
                {type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'},
                {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello'}
            );
            await wait(50);
        });
        expect(header(container).textContent).toContain('Writing');
        expect(container.querySelector('.xh-chat-message__text .xh-chat-caret')).toBeTruthy();

        await act(async () => {
            end();
            await sending;
        });
        expect(header(container).textContent).not.toContain('Writing');
        expect(container.querySelector('.xh-chat-caret')).toBeNull();
    });

    it('shows a quiet reply as stalled, and clears it silently on the next byte', async () => {
        vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']});
        vi.setSystemTime(100_000);
        const {transport, heartbeat, end} = manualTransport(),
            model = createModel({transport, stallAfterMs: 5000}),
            {container} = render(chatMessageList({model}));

        let sending: Promise<void>;
        await act(async () => {
            sending = model.sendAsync('Hi');
            await wait(10);
        });

        act(() => vi.advanceTimersByTime(6000));
        expect(header(container).textContent).toContain('No response for 6s');
        expect(header(container).querySelector('.xh-chat-status-cue--warning')).toBeTruthy();
        expect(header(container).querySelector('.xh-chat-spinner')).toBeNull();

        act(() => {
            heartbeat();
            vi.advanceTimersByTime(1000);
        });
        expect(header(container).textContent).toContain('Thinking');
        expect(chatAnnouncer.polite).toBeNull();

        await act(async () => {
            end();
            await sending;
        });
    });

    it('announces a reply once, as it finishes: name, tools, time and first paragraph', async () => {
        const transport = new ScriptedChatTransport({
                responses: [
                    toolCallEvents('lookup', {}, {toolCallId: 'c1'}),
                    textEvents('HY Credit is over its limit.\n\nEM Rates is next.')
                ]
            }),
            model = createModel({transport, tools: [{name: 'lookup', execute: () => 'ok'}]}),
            {container} = render(chatMessageList({model, assistantName: 'Credit Analyst'}));

        await act(() => model.sendAsync('Which desks are over?'));

        const text = chatAnnouncer.polite?.text;
        expect(text).toMatch(/^Credit Analyst replied after 1 tool/);
        expect(text).toContain('HY Credit is over its limit. Continues in the message.');
        expect(text).not.toContain('EM Rates');
        expect(container.querySelector('.xh-chat-announcer [role="status"]').textContent).toBe(
            text
        );
    });

    it('never announces history loaded into the list', () => {
        const model = createModel({});
        render(chatMessageList({model}));

        act(() =>
            model.loadMessages([
                {role: 'user', content: 'Hi'},
                {role: 'assistant', content: 'Hello.'}
            ])
        );
        expect(chatAnnouncer.polite).toBeNull();
    });

    it('announces a reply the user stopped', async () => {
        const {transport} = manualTransport(),
            model = createModel({transport});
        render(chatMessageList({model}));

        await act(async () => {
            model.sendAsync('Hi');
            await wait(10);
        });
        act(() => model.stop());
        expect(chatAnnouncer.polite?.text).toBe('Reply stopped.');
    });
});

//------------------
// Helpers
//------------------
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

function createModel(config: Partial<ChatModelConfig>): ChatModel {
    const model = new ChatModel({transport: new ScriptedChatTransport(), ...config});
    onTestFinished(() => model.destroy());
    return model;
}

function header(container: HTMLElement): HTMLElement {
    return container.querySelector('.xh-chat-message--assistant .xh-chat-message__header');
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A transport whose step the test drives: `push` yields events, `heartbeat` reports data that
 * decodes to nothing, and `end` finishes the step.
 */
function manualTransport() {
    let request: ChatRunRequest = null,
        queue: Array<ChatEvent | 'end'> = [],
        wake: () => void = null;
    const notify = () => {
            wake?.();
            wake = null;
        },
        transport: ChatTransport = {
            async *run(req) {
                request = req;
                while (!req.signal.aborted) {
                    if (!queue.length) await new Promise<void>(resolve => (wake = resolve));
                    const next = queue.shift();
                    if (next === 'end') {
                        yield {type: 'RUN_FINISHED', threadId: req.threadId, runId: req.runId};
                        return;
                    }
                    if (next) yield next;
                }
            }
        };

    return {
        transport,
        push: (...events: ChatEvent[]) => {
            queue = [...queue, ...events];
            notify();
        },
        heartbeat: () => request.onActivity(),
        end: () => {
            queue = [...queue, 'end'];
            notify();
        }
    };
}
