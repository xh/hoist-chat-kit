import type {PlainObject} from '@xh/hoist/core';
import {hoistCore, hoistError, initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {ChatMessage} from '../core';
import type {ChatEvent} from './ChatEvent';
import type {ChatRunRequest} from './ChatTransport';
import {AnthropicCodec} from './codec/AnthropicCodec';
import {HoistChatTransport} from './HoistChatTransport';

/**
 * HoistChatTransport is the default way a Hoist app talks to its own chat endpoint. Tokens must
 * reach the chat as each line arrives, a stop must end the call at once - closing the connection,
 * so the server stops generating - and a server failure must surface with Hoist's error details.
 */
describe('HoistChatTransport', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('posts the encoded request as JSON and yields the decoded events', async () => {
        const stream = ndjsonStream();
        hoistCore.route('POST', 'chat', () => stream.response);
        stream.push(TEXT_START, TEXT_CONTENT, FINISHED);
        stream.close();

        const transport = new HoistChatTransport({
                url: 'chat',
                params: {agent: 'weather'},
                headers: {'X-Agent-Key': 'k1'}
            }),
            events = await collect(transport.run(request()));

        expect(events).toEqual([TEXT_START, TEXT_CONTENT, FINISHED]);

        const [req] = hoistCore.requestsTo('chat');
        expect(req.headers).toMatchObject({
            'content-type': 'application/json',
            'x-agent-key': 'k1'
        });
        expect(req.query).toEqual({agent: 'weather'});
        expect(req.json).toMatchObject({
            threadId: 't1',
            runId: 'r1',
            messages: [{role: 'user', content: 'Hi'}]
        });
    });

    it('yields each event as its line arrives', async () => {
        const stream = ndjsonStream();
        hoistCore.route('POST', 'chat', () => stream.response);

        const events = new HoistChatTransport({url: 'chat'}).run(request());
        stream.push(TEXT_START);
        expect((await events.next()).value).toEqual(TEXT_START);

        stream.push(TEXT_CONTENT);
        expect((await events.next()).value).toEqual(TEXT_CONTENT);

        stream.close();
        expect((await events.next()).done).toBe(true);
    });

    it('awaits a codec that builds its request asynchronously', async () => {
        const stream = ndjsonStream();
        hoistCore.route('POST', 'chat', () => stream.response);
        stream.close();

        const codec = new AnthropicCodec({system: async () => 'Live context.'});
        await collect(new HoistChatTransport({url: 'chat', codec}).run(request()));

        expect(hoistCore.requestsTo('chat')[0].json).toMatchObject({system: 'Live context.'});
    });

    it('decodes each line with the configured codec', async () => {
        const stream = ndjsonStream();
        hoistCore.route('POST', 'chat', () => stream.response);
        stream.push({type: 'error', error: {type: 'overloaded_error', message: 'Overloaded'}});
        stream.close();

        const transport = new HoistChatTransport({url: 'chat', codec: new AnthropicCodec()}),
            events = await collect(transport.run(request()));

        expect(events).toEqual([
            {type: 'RUN_ERROR', message: 'Overloaded', code: 'overloaded_error'}
        ]);
        expect(hoistCore.requestsTo('chat')[0].json).toMatchObject({stream: true});
    });

    it('stops at once and closes the connection when the signal aborts mid-stream', async () => {
        const stream = ndjsonStream(),
            signals = spyFetchSignals('chat'),
            controller = new AbortController();
        hoistCore.route('POST', 'chat', () => stream.response);

        const events = new HoistChatTransport({url: 'chat'}).run(request(controller.signal));
        stream.push(TEXT_START);
        await events.next();

        // The server sends nothing more - the pending read must still end promptly.
        const next = events.next();
        controller.abort();

        await expect(next).rejects.toMatchObject({name: 'AbortError'});
        expect(signals[0].aborted).toBe(true);
    });

    it('closes the connection when the caller stops reading early', async () => {
        const stream = ndjsonStream(),
            signals = spyFetchSignals('chat');
        hoistCore.route('POST', 'chat', () => stream.response);
        stream.push(TEXT_START, TEXT_CONTENT);

        for await (const event of new HoistChatTransport({url: 'chat'}).run(request())) {
            if (event.type === 'TEXT_MESSAGE_START') break;
        }

        expect(signals[0].aborted).toBe(true);
    });

    it('throws without a request when the signal has already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            collect(new HoistChatTransport({url: 'chat'}).run(request(controller.signal)))
        ).rejects.toMatchObject({name: 'AbortError'});
        expect(hoistCore.requestsTo('chat')).toEqual([]);
    });

    it('throws the server error, with its details, when the request fails', async () => {
        hoistCore.route('POST', 'chat', () =>
            hoistError(500, {name: 'LlmException', message: 'Rate limit exceeded.'})
        );

        await expect(
            collect(new HoistChatTransport({url: 'chat'}).run(request()))
        ).rejects.toMatchObject({
            name: 'LlmException',
            message: 'Rate limit exceeded.',
            httpStatus: 500,
            isFetchAborted: false
        });
    });
});

//------------------
// Helpers
//------------------
const TEXT_START: ChatEvent = {type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'},
    TEXT_CONTENT: ChatEvent = {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello'},
    FINISHED: ChatEvent = {type: 'RUN_FINISHED', threadId: 't1', runId: 'r1'};

function request(signal: AbortSignal = new AbortController().signal): ChatRunRequest {
    return {
        threadId: 't1',
        runId: 'r1',
        messages: [new ChatMessage({role: 'user', content: 'Hi'})],
        tools: [],
        signal
    };
}

/** An NDJSON response whose lines the test writes as it goes. */
function ndjsonStream() {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({start: it => (controller = it)});
    return {
        response: new Response(body, {headers: {'Content-Type': 'application/x-ndjson'}}),
        push: (...records: PlainObject[]) =>
            records.forEach(it => controller.enqueue(encoder.encode(JSON.stringify(it) + '\n'))),
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
