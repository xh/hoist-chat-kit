import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {ChatEvent, ChatRunRequest, ChatTransport} from '../transport';
import {ChatKit} from './ChatKit';
import {ChatModel, type ChatModelConfig} from './ChatModel';
import {getChatReplyStatus} from './ChatReplyStatus';

/**
 * The activity time a ChatModel keeps for the step in flight, which shows a quiet reply as
 * stalled. Apps rely on it counting every byte - events and undecoded heartbeats alike - and on it
 * being null whenever no step waits on the server, so that a slow client tool never reads as a
 * stall.
 */
describe('ChatModel activity', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts when the request goes out, and clears when the turn ends', async () => {
        useClock(10_000);
        const {transport, push, end, started} = manualTransport(),
            model = createModel({transport});

        expect(model.lastActivityAt).toBeNull();
        const sending = model.sendAsync('Hi');
        await started();
        expect(model.lastActivityAt).toBe(10_000);

        push(...textStart());
        end();
        await sending;
        expect(model.lastActivityAt).toBeNull();
    });

    it('moves forward with each event, at most once a second', async () => {
        useClock(10_000);
        const {transport, push, end, started, settled} = manualTransport(),
            model = createModel({transport}),
            sending = model.sendAsync('Hi');
        await started();

        vi.setSystemTime(10_400);
        push(...textStart());
        await settled();
        expect(model.lastActivityAt).toBe(10_000);

        vi.setSystemTime(11_200);
        push(textDelta(' there'));
        await settled();
        expect(model.lastActivityAt).toBe(11_200);

        end();
        await sending;
    });

    it('moves forward with a heartbeat that the transport reads but never decodes', async () => {
        useClock(10_000);
        const {transport, heartbeat, end, started} = manualTransport(),
            model = createModel({transport}),
            sending = model.sendAsync('Hi');
        await started();

        vi.setSystemTime(45_000);
        heartbeat();
        expect(model.lastActivityAt).toBe(45_000);
        expect(model.status).toBe('submitted');

        end();
        await sending;
    });

    it('reads as stalled after the stall time with no data, and clears on the next byte', async () => {
        useClock(10_000);
        const {transport, heartbeat, end, started} = manualTransport(),
            model = createModel({transport, stallAfterMs: 5000}),
            sending = model.sendAsync('Hi'),
            statusAt = (now: number) =>
                getChatReplyStatus({
                    message: model.lastMessage,
                    lastActivityAt: model.lastActivityAt,
                    stallAfterMs: model.stallAfterMs,
                    now
                });
        await started();

        expect(statusAt(14_999)).toBe('submitted');
        expect(statusAt(15_000)).toBe('stalled');

        vi.setSystemTime(15_000);
        heartbeat();
        expect(statusAt(15_000)).toBe('submitted');

        end();
        await sending;
    });

    it('is null while a client tool runs between steps', async () => {
        let activityDuringTool: number = undefined;
        const {transport, push, end, started} = manualTransport(),
            model = createModel({
                transport,
                tools: [
                    {
                        name: 'lookup',
                        execute: () => {
                            activityDuringTool = model.lastActivityAt;
                            return 'ok';
                        }
                    }
                ]
            }),
            sending = model.sendAsync('Find it');
        await started();

        push(
            {type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'lookup'},
            {type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{}'},
            {type: 'TOOL_CALL_END', toolCallId: 'c1'}
        );
        end();
        await started(2);
        expect(activityDuringTool).toBeNull();
        expect(model.lastActivityAt).not.toBeNull();

        push(...textStart());
        end();
        await sending;
    });

    it('takes its stall time from the config, else from ChatKit.defaults', () => {
        const {transport} = manualTransport();
        expect(createModel({transport}).stallAfterMs).toBe(ChatKit.defaults.stallAfterMs);
        expect(createModel({transport, stallAfterMs: 45_000}).stallAfterMs).toBe(45_000);
    });
});

//------------------
// Helpers
//------------------
function createModel(config: ChatModelConfig): ChatModel {
    const model = new ChatModel(config);
    onTestFinished(() => model.destroy());
    return model;
}

/**
 * Resolve once a condition holds, polling on the real timers. Unlike `vi.waitFor`, it never
 * advances the fake clock.
 */
async function until(condition: () => boolean) {
    for (let i = 0; i < 200; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
        if (condition()) return;
    }
    throw new Error('Timed out waiting for the condition.');
}

/** Fake only the clock, so the stream's own promises and timers still run. */
function useClock(now: number) {
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(now);
}

function textStart(): ChatEvent[] {
    return [{type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'}, textDelta('Hello')];
}

function textDelta(delta: string): ChatEvent {
    return {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta};
}

/**
 * A transport whose steps the test drives: `push` yields events, `heartbeat` reports data that
 * decodes to nothing, and `end` finishes the step in flight.
 */
function manualTransport() {
    let request: ChatRunRequest = null,
        runs = 0,
        queue: Array<ChatEvent | 'end'> = [],
        wake: () => void = null;
    const notify = () => {
        wake?.();
        wake = null;
    };

    const transport: ChatTransport = {
        async *run(req) {
            request = req;
            runs++;
            while (true) {
                if (!queue.length) await new Promise<void>(resolve => (wake = resolve));
                const next = queue.shift();
                if (next === 'end') {
                    yield {type: 'RUN_FINISHED', threadId: req.threadId, runId: req.runId};
                    return;
                }
                yield next;
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
        },
        /** Resolve once the given number of steps have started. */
        started: (count = 1) => until(() => runs === count),
        /** Resolve once the events pushed so far are read. */
        settled: () => until(() => queue.length === 0)
    };
}
