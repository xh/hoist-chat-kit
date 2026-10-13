import {hoistCore, hoistError, initTestAppAsync, noContent} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {ChatMessage} from '../core';
import type {ChatEvent} from './ChatEvent';
import type {ChatRunRequest} from './ChatTransport';
import {AnthropicCodec} from './codec/AnthropicCodec';
import {SseChatTransport} from './SseChatTransport';

/**
 * SseChatTransport connects the chat to AG-UI agent servers and to proxies that relay a
 * provider's SSE stream. It must parse frames as they arrive, hand the codec each event's name and
 * data, skip keep-alives and sentinels, and stop at once - closing the connection - on abort.
 */
describe('SseChatTransport', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('posts the encoded request for an event stream and yields the decoded events', async () => {
        const stream = sseStream();
        hoistCore.route('POST', 'agent', () => stream.response);
        stream.write(
            `: connected\n\ndata: ${JSON.stringify(TEXT_START)}\n\n`,
            `data: ${JSON.stringify(TEXT_CONTENT)}\n\ndata: [DONE]\n\n`
        );
        stream.close();

        const transport = new SseChatTransport({url: 'agent', headers: {'X-Agent-Key': 'k1'}}),
            events = await collect(transport.run(request()));

        expect(events).toEqual([TEXT_START, TEXT_CONTENT]);

        const [req] = hoistCore.requestsTo('agent');
        expect(req.headers).toMatchObject({
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'x-agent-key': 'k1'
        });
        expect(req.json).toMatchObject({threadId: 't1', runId: 'r1'});
    });

    it('passes each event name to the codec with its data', async () => {
        const stream = sseStream();
        hoistCore.route('POST', 'agent', () => stream.response);
        // Split mid-frame, as the network may.
        stream.write(
            'event: error\ndata: {"error": {"type": "api_er',
            'ror", "message": "Boom"}}\n\n'
        );
        stream.close();

        const transport = new SseChatTransport({url: 'agent', codec: new AnthropicCodec()}),
            events = await collect(transport.run(request()));

        expect(events).toEqual([{type: 'RUN_ERROR', message: 'Boom', code: 'api_error'}]);
    });

    it('skips data that is not JSON, such as a plain-text keep-alive', async () => {
        const stream = sseStream();
        hoistCore.route('POST', 'agent', () => stream.response);
        stream.write('data: ping\n\n', `data: ${JSON.stringify(TEXT_START)}\n\n`);
        stream.close();

        const events = await collect(new SseChatTransport({url: 'agent'}).run(request()));

        expect(events).toEqual([TEXT_START]);
    });

    it('yields no events for an empty response', async () => {
        hoistCore.route('POST', 'agent', () => noContent());

        const events = await collect(new SseChatTransport({url: 'agent'}).run(request()));

        expect(events).toEqual([]);
    });

    it('closes the connection when the caller stops reading early', async () => {
        const stream = sseStream(),
            signals = spyFetchSignals('agent');
        hoistCore.route('POST', 'agent', () => stream.response);
        stream.write(
            `data: ${JSON.stringify(TEXT_START)}\n\ndata: ${JSON.stringify(TEXT_CONTENT)}\n\n`
        );

        for await (const event of new SseChatTransport({url: 'agent'}).run(request())) {
            if (event.type === 'TEXT_MESSAGE_START') break;
        }

        expect(signals[0].aborted).toBe(true);
    });

    it('stops at once and closes the connection when the signal aborts mid-stream', async () => {
        const stream = sseStream(),
            signals = spyFetchSignals('agent'),
            controller = new AbortController();
        hoistCore.route('POST', 'agent', () => stream.response);

        const events = new SseChatTransport({url: 'agent'}).run(request(controller.signal));
        stream.write(`data: ${JSON.stringify(TEXT_START)}\n\n`);
        await events.next();

        const next = events.next();
        controller.abort();

        await expect(next).rejects.toMatchObject({name: 'AbortError'});
        expect(signals[0].aborted).toBe(true);
    });

    it('throws the server error, with its details, when the request fails', async () => {
        hoistCore.route('POST', 'agent', () => hoistError(503, {message: 'Agent unavailable.'}));

        await expect(
            collect(new SseChatTransport({url: 'agent'}).run(request()))
        ).rejects.toMatchObject({
            message: 'Agent unavailable.',
            httpStatus: 503
        });
    });
});

//------------------
// Helpers
//------------------
const TEXT_START: ChatEvent = {type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'},
    TEXT_CONTENT: ChatEvent = {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello'};

function request(signal: AbortSignal = new AbortController().signal): ChatRunRequest {
    return {
        threadId: 't1',
        runId: 'r1',
        messages: [new ChatMessage({role: 'user', content: 'Hi'})],
        tools: [],
        signal
    };
}

/** A `text/event-stream` response whose chunks the test writes as it goes. */
function sseStream() {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({start: it => (controller = it)});
    return {
        response: new Response(body, {headers: {'Content-Type': 'text/event-stream'}}),
        write: (...chunks: string[]) =>
            chunks.forEach(it => controller.enqueue(encoder.encode(it))),
        close: () => controller.close()
    };
}

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
    const ret: ChatEvent[] = [];
    for await (const event of events) ret.push(event);
    return ret;
}

/** The abort signal passed to `fetch()` for each request to `path`, in order. */
function spyFetchSignals(path: string): AbortSignal[] {
    const ret: AbortSignal[] = [],
        fetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        if (String(input).includes(path)) ret.push(init?.signal);
        return fetch(input, init);
    });
    return ret;
}
