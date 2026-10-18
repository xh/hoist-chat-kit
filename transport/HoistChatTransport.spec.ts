import {type PlainObject, XH} from '@xh/hoist/core';
import {hoistCore, hoistError, initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatMessage, ChatModel, ChatRunError, isChatRetrySafe} from '../core';
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
        stream.push(STARTED, TEXT_START, TEXT_CONTENT, TEXT_END, FINISHED);
        stream.close();

        const transport = new HoistChatTransport({
                url: 'chat',
                params: {agent: 'weather'},
                headers: {'X-Agent-Key': 'k1'}
            }),
            events = await collect(transport.run(request()));

        expect(events).toEqual([STARTED, TEXT_START, TEXT_CONTENT, TEXT_END, FINISHED]);

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
        stream.push(STARTED);
        expect((await events.next()).value).toEqual(STARTED);

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
        stream.push(STARTED);
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
        stream.push(STARTED, TEXT_START, TEXT_CONTENT);

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

    it('builds headers per request from a function', async () => {
        const stream = ndjsonStream();
        hoistCore.route('POST', 'chat', () => stream.response);
        stream.close();

        const transport = new HoistChatTransport({
            url: 'chat',
            headers: req => ({'X-Thread-Id': req.threadId, 'X-Run-Id': req.runId})
        });
        await collect(transport.run(request()));

        expect(hoistCore.requestsTo('chat')[0].headers).toMatchObject({
            'x-thread-id': 't1',
            'x-run-id': 'r1'
        });
    });

    it('builds the url, headers and params per request from async functions', async () => {
        const stream = ndjsonStream();
        hoistCore.route('POST', 'chat/t1', () => stream.response);
        stream.close();

        const transport = new HoistChatTransport({
            url: async req => `chat/${req.threadId}`,
            headers: async () => ({Authorization: 'Bearer fresh'}),
            params: req => ({run: req.runId})
        });
        await collect(transport.run(request()));

        const [req] = hoistCore.requestsTo('chat/t1');
        expect(req.headers).toMatchObject({authorization: 'Bearer fresh'});
        expect(req.query).toEqual({run: 'r1'});
    });

    describe('cancelAsync', () => {
        it('posts the run ids to the cancelUrl, with the headers of the stopped step', async () => {
            hoistCore.route('POST', 'chat/cancel/srv-run', () => null);
            const transport = new HoistChatTransport({
                url: 'chat',
                headers: req => ({'X-Turn': req.turnId}),
                cancelUrl: run => `chat/cancel/${run.runId}`
            });

            await transport.cancelAsync({
                threadId: 't1',
                runId: 'srv-run',
                turnId: 'u1',
                request: request()
            });

            const [req] = hoistCore.requestsTo('chat/cancel/srv-run');
            expect(req.json).toEqual({threadId: 't1', runId: 'srv-run', turnId: 'u1'});
            expect(req.headers).toMatchObject({'x-turn': 'u1'});
        });

        it('does nothing without a cancelUrl', async () => {
            const transport = new HoistChatTransport({url: 'chat'});
            await expect(
                transport.cancelAsync({threadId: 't1', runId: 'r1', turnId: 'u1'})
            ).resolves.toBeUndefined();
        });

        it('cancels the run when the user stops a turn', async () => {
            const stream = ndjsonStream();
            hoistCore.route('POST', 'chat', () => stream.response);
            hoistCore.route('POST', 'chat/cancel', () => null);
            stream.push(
                {type: 'RUN_STARTED', threadId: 't1', runId: 'srv-run'},
                TEXT_START,
                TEXT_CONTENT
            );

            const chatModel = new ChatModel({
                transport: new HoistChatTransport({url: 'chat', cancelUrl: 'chat/cancel'}),
                historyMode: 'server'
            });
            onTestFinished(() => chatModel.destroy());

            const done = chatModel.sendAsync('Hi');
            await vi.waitFor(() => expect(chatModel.lastMessage.text).toBe('Hello'));
            chatModel.stop();
            await done;
            await hoistCore.settleAsync();

            const [req] = hoistCore.requestsTo('chat/cancel');
            expect(req.json).toEqual({
                threadId: chatModel.threadId,
                runId: 'srv-run',
                turnId: chatModel.messages[0].id
            });
        });
    });

    describe('idle timeout', () => {
        it('fails the step as stalled, and closes the connection, when no data arrives', async () => {
            const stream = ndjsonStream(),
                signals = spyFetchSignals('chat');
            hoistCore.route('POST', 'chat', () => stream.response);
            stream.push(STARTED, TEXT_START);

            const events = await collect(
                new HoistChatTransport({url: 'chat', idleTimeout: 50}).run(request())
            );

            expect(events).toEqual([
                STARTED,
                TEXT_START,
                {type: 'RUN_ERROR', message: 'The server stopped responding.', code: 'stalled'}
            ]);
            expect(signals[0].aborted).toBe(true);
        });

        it('resets on each heartbeat record, which is never decoded', async () => {
            const stream = ndjsonStream();
            hoistCore.route('POST', 'chat', () => stream.response);

            const events = collect(
                new HoistChatTransport({url: 'chat', idleTimeout: 120}).run(request())
            );
            for (let i = 0; i < 4; i++) {
                await sleep(50);
                stream.push({type: 'xh.heartbeat'});
            }
            stream.push(STARTED, FINISHED);
            stream.close();

            expect(await events).toEqual([STARTED, FINISHED]);
        });

        it('reports each record it reads as activity, heartbeats included', async () => {
            const stream = ndjsonStream(),
                onActivity = vi.fn();
            hoistCore.route('POST', 'chat', () => stream.response);
            stream.push(STARTED, {type: 'xh.heartbeat'}, {type: 'xh.heartbeat'}, FINISHED);
            stream.close();

            const events = await collect(
                new HoistChatTransport({url: 'chat'}).run({...request(), onActivity})
            );

            expect(events).toEqual([STARTED, FINISHED]);
            expect(onActivity).toHaveBeenCalledTimes(4);
        });

        it('fails the turn with a ChatRunError coded stalled', async () => {
            const stream = ndjsonStream();
            hoistCore.route('POST', 'chat', () => stream.response);
            const chatModel = new ChatModel({
                transport: new HoistChatTransport({url: 'chat', idleTimeout: 50})
            });
            onTestFinished(() => chatModel.destroy());

            await chatModel.sendAsync('Hi');

            expect(chatModel.lastError).toBeInstanceOf(ChatRunError);
            expect(chatModel.lastError).toMatchObject({code: 'stalled'});
        });
    });

    /**
     * How failures reach Hoist's exception pipeline. Apps rely on errors within the stream staying
     * conversation state, and on routine server exceptions - such as a rate limit - never being
     * logged or emailed as client errors.
     */
    describe('errors in a chat', () => {
        it('keeps a routine server exception routine, so it is not logged as a client error', async () => {
            const {handleException, logOnServer} = spyExceptionPipeline();
            hoistCore.route('POST', 'chat', () =>
                hoistError(429, {
                    name: 'RoutineRuntimeException',
                    message: 'Rate limit reached - try again in a minute.',
                    isRoutine: true
                })
            );
            const chatModel = createChat();

            await chatModel.sendAsync('Hi');

            expect(chatModel.lastError).toMatchObject({httpStatus: 429, isRoutine: true});
            expect(chatModel.lastMessage.error).toBe('Rate limit reached - try again in a minute.');
            expect(handleException).toHaveBeenCalledExactlyOnceWith(chatModel.lastError, {
                showAlert: false
            });
            expect(logOnServer).not.toHaveBeenCalled();
        });

        it('reports an unexpected server exception as a client error', async () => {
            const {logOnServer} = spyExceptionPipeline();
            hoistCore.route('POST', 'chat', () => hoistError(500, {message: 'Boom'}));
            const chatModel = createChat();

            await chatModel.sendAsync('Hi');

            expect(chatModel.lastError).toMatchObject({httpStatus: 500, isRoutine: false});
            expect(logOnServer).toHaveBeenCalledOnce();
        });

        it('shows an error event within the stream, without reporting an exception', async () => {
            const {handleException} = spyExceptionPipeline(),
                stream = ndjsonStream();
            hoistCore.route('POST', 'chat', () => stream.response);
            stream.push(
                {type: 'message_start', message: {id: 'msg1', model: 'claude', usage: {}}},
                {type: 'error', error: {type: 'rate_limit_error', message: 'Slow down.'}}
            );
            stream.close();
            const chatModel = createChat(new AnthropicCodec());

            await chatModel.sendAsync('Hi');

            expect(chatModel.lastError).toBeInstanceOf(ChatRunError);
            expect(chatModel.lastError).toMatchObject({code: 'rate_limit_error'});
            expect(handleException).not.toHaveBeenCalled();
        });

        it('fails the turn on a stream that breaks the AG-UI rules, and reports it', async () => {
            const {handleException, logOnServer} = spyExceptionPipeline(),
                stream = ndjsonStream();
            hoistCore.route('POST', 'chat', () => stream.response);
            stream.push(TEXT_START, TEXT_CONTENT);
            stream.close();
            const chatModel = createChat();

            await chatModel.sendAsync('Hi');

            expect(chatModel.lastError).toBeInstanceOf(ChatRunError);
            expect(chatModel.lastError).toMatchObject({code: 'invalid-stream'});
            expect(chatModel.lastMessage).toMatchObject({
                status: 'error',
                error: "Invalid AG-UI stream: First event must be 'RUN_STARTED'",
                metadata: expect.objectContaining({errorCode: 'invalid-stream'})
            });
            expect(handleException).toHaveBeenCalledOnce();
            expect(logOnServer).toHaveBeenCalledOnce();
        });

        it('records a rejected stream in server mode as such, not as a lost connection', async () => {
            spyExceptionPipeline();
            const stream = ndjsonStream();
            hoistCore.route('POST', 'chat', () => stream.response);
            stream.push(TEXT_START);
            stream.close();
            const chatModel = new ChatModel({
                transport: new HoistChatTransport({url: 'chat'}),
                historyMode: 'server'
            });
            onTestFinished(() => chatModel.destroy());

            await chatModel.sendAsync('Hi');

            expect(chatModel.lastMessage.metadata.errorCode).toBe('invalid-stream');
            expect(isChatRetrySafe(chatModel.lastMessage, 'server')).toBe(false);
        });

        it('reads on after RUN_ERROR, so a later run in the stream completes the turn', async () => {
            const stream = ndjsonStream();
            hoistCore.route('POST', 'chat', () => stream.response);
            stream.push(
                STARTED,
                {type: 'RUN_ERROR', message: 'The first run failed.'},
                {type: 'RUN_STARTED', threadId: 't1', runId: 'r2'},
                TEXT_START,
                TEXT_CONTENT,
                TEXT_END,
                {type: 'RUN_FINISHED', threadId: 't1', runId: 'r2'}
            );
            stream.close();
            const chatModel = createChat();

            await chatModel.sendAsync('Hi');

            expect(chatModel.lastError).toBeNull();
            expect(chatModel.lastMessage).toMatchObject({status: 'complete', text: 'Hello'});
        });

        it('fails the turn with the error of a stream that ends on RUN_ERROR', async () => {
            const stream = ndjsonStream();
            hoistCore.route('POST', 'chat', () => stream.response);
            stream.push(STARTED, {type: 'RUN_ERROR', message: 'Busy.', code: 'busy'});
            stream.close();
            const chatModel = createChat();

            await chatModel.sendAsync('Hi');

            expect(chatModel.lastError).toMatchObject({code: 'busy', message: 'Busy.'});
        });

        it('shows a stream that ends early, without reporting an exception', async () => {
            const {handleException} = spyExceptionPipeline(),
                stream = ndjsonStream();
            hoistCore.route('POST', 'chat', () => stream.response);
            stream.push(STARTED, TEXT_START, TEXT_CONTENT);
            stream.close();
            const chatModel = createChat();

            await chatModel.sendAsync('Hi');

            expect(chatModel.lastError).toMatchObject({code: 'incomplete-stream'});
            expect(handleException).not.toHaveBeenCalled();
        });
    });
});

//------------------
// Helpers
//------------------
function createChat(codec?: AnthropicCodec): ChatModel {
    const chatModel = new ChatModel({transport: new HoistChatTransport({url: 'chat', codec})});
    onTestFinished(() => chatModel.destroy());
    return chatModel;
}

/** Spies on Hoist's exception handling, with the real handler but no server logging. */
function spyExceptionPipeline() {
    const handleException = vi.spyOn(XH, 'handleException'),
        logOnServer = vi.spyOn(XH.exceptionHandler, 'logOnServerAsync').mockResolvedValue(true),
        logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => {
        handleException.mockRestore();
        logOnServer.mockRestore();
        logError.mockRestore();
    });
    return {handleException, logOnServer};
}

// A conforming AG-UI stream, which the codec's checks require, opens with RUN_STARTED.
const STARTED: ChatEvent = {type: 'RUN_STARTED', threadId: 't1', runId: 'r1'},
    TEXT_START: ChatEvent = {type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant'},
    TEXT_CONTENT: ChatEvent = {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello'},
    TEXT_END: ChatEvent = {type: 'TEXT_MESSAGE_END', messageId: 'm1'},
    FINISHED: ChatEvent = {type: 'RUN_FINISHED', threadId: 't1', runId: 'r1'};

function request(signal: AbortSignal = new AbortController().signal): ChatRunRequest {
    const message = new ChatMessage({id: 'u1', role: 'user', content: 'Hi'});
    return {
        threadId: 't1',
        runId: 'r1',
        historyMode: 'client',
        trigger: 'submit',
        turnId: 'u1',
        stepIndex: 0,
        messages: [message],
        newMessages: [message],
        replacedMessageId: null,
        runOptions: null,
        catalogVersion: null,
        tools: [],
        context: [],
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

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
