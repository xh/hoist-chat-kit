import {hoistCore, hoistError, initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {errorEvents, ScriptedChatTransport, SseChatTransport, textEvents} from '../transport';
import type {ChatEvent, ChatTransport} from '../transport';
import type {ChatComposerHost} from './ChatComposerHost';
import {ChatComposerModel} from './ChatComposerModel';
import {
    type ChatComposerStatusSpec,
    type ChatComposerStatusType,
    getChatComposerStatus,
    isChatRetrySafe
} from './ChatComposerStatus';
import {ChatMessage, type ChatMessageSpec} from './ChatMessage';
import {ChatModel, type ChatModelConfig} from './ChatModel';

/**
 * The status region above the composer holds the thread's one next action. Which status shows,
 * and which action it offers, decides whether a resend could run a write twice - so the
 * retry-safety rules of D64 and the priority of P5 are pinned here.
 */
describe('isChatRetrySafe', () => {
    it.each([
        ['a failure with no word from the server', {}, 'client', true],
        ['a failure the server marks unsafe', {retrySafe: false}, 'client', false],
        ['a failure the server marks safe', {retrySafe: true}, 'server', true],
        ['a stall in client mode', {errorCode: 'stalled'}, 'client', true],
        ['a stall in server mode', {errorCode: 'stalled'}, 'server', false],
        ['a dropped stream in server mode', {errorCode: 'incomplete-stream'}, 'server', false],
        ['a dropped stream in client mode', {errorCode: 'incomplete-stream'}, 'client', true],
        ['a rejected AG-UI stream in server mode', {errorCode: 'invalid-stream'}, 'server', false],
        ['a rejected AG-UI stream in client mode', {errorCode: 'invalid-stream'}, 'client', true],
        ['a lost connection in server mode', {errorCode: 'connection-lost'}, 'server', false],
        ['a lost connection in client mode', {errorCode: 'connection-lost'}, 'client', true],
        ['a server error code in server mode', {errorCode: 'overloaded_error'}, 'server', true]
    ] as const)('reads %s', (_, metadata, historyMode, expected) => {
        expect(isChatRetrySafe(failed(metadata), historyMode)).toBe(expected);
    });
});

describe('getChatComposerStatus', () => {
    const NOW = 1_000_000;

    it.each<[string, ChatComposerStatusType, Partial<ChatComposerStatusSpec>]>([
        [
            'a send blocker first',
            'blocked',
            {sendBlockedReason: 'Wait.', isOffline: true, lastMessage: failed()}
        ],
        ['offline before a failure', 'offline', {isOffline: true, lastMessage: failed()}],
        ['a failure before a draft notice', 'failed', {lastMessage: failed(), draftSavedAt: NOW}],
        [
            'an interrupted run as failed',
            'failed',
            {lastMessage: failed({errorCode: 'interrupted'})}
        ],
        ['a server cancel as failed', 'failed', {lastMessage: failed({errorCode: 'cancelled'})}],
        ['a reply left running as detached', 'detached', {lastMessage: detached()}],
        [
            'a reply with no data past the stall time as stalled',
            'stalled',
            {lastMessage: streaming(), lastActivityAt: NOW - 31_000, stallAfterMs: 30_000}
        ],
        ['a reply in progress as busy', 'busy', {lastMessage: streaming(), lastActivityAt: NOW}],
        ['a paused turn', 'paused', {lastMessage: reply({status: 'paused'})}],
        ['a restored draft last', 'draftRestored', {lastMessage: complete(), draftSavedAt: NOW}]
    ])('shows %s', (_, type, spec) => {
        expect(getChatComposerStatus({now: NOW, canRetry: true, ...spec}).type).toBe(type);
    });

    it('shows nothing for a finished or stopped reply', () => {
        expect(getChatComposerStatus({lastMessage: complete()})).toBeNull();
        expect(getChatComposerStatus({lastMessage: reply({status: 'aborted'})})).toBeNull();
        expect(getChatComposerStatus({})).toBeNull();
    });

    it('offers Try Again for a retry-safe failure, with its error', () => {
        const status = getChatComposerStatus({lastMessage: failed(), canRetry: true});
        expect(status).toMatchObject({
            type: 'failed',
            action: 'tryAgain',
            isRetrySafe: true,
            reason: 'Model timed out.'
        });
    });

    it('offers Refresh Status for a failure that is not retry-safe, when the host can refresh', () => {
        const spec: ChatComposerStatusSpec = {
            lastMessage: failed({errorCode: 'incomplete-stream'}),
            historyMode: 'server',
            canRetry: true
        };

        expect(getChatComposerStatus({...spec, canRefreshStatus: true})).toMatchObject({
            action: 'refreshStatus',
            isRetrySafe: false
        });
        // Without a thread layer, Try Again is the only recovery - the region says it may run.
        expect(getChatComposerStatus(spec)).toMatchObject({action: 'tryAgain', isRetrySafe: false});
    });

    it('offers Refresh Status for a stalled or detached reply only when the host can refresh', () => {
        const stalled = {lastMessage: streaming(), lastActivityAt: NOW - 40_000, now: NOW};
        expect(getChatComposerStatus({...stalled, canRefreshStatus: true})).toMatchObject({
            action: 'refreshStatus',
            stalledMs: 40_000
        });
        expect(getChatComposerStatus(stalled).action).toBeNull();
        expect(getChatComposerStatus({lastMessage: detached()}).action).toBeNull();
    });

    it('counts down to a retry while the composer waits, else shows the failure', () => {
        const lastMessage = failed({retryAfterSeconds: 30}, NOW - 10_000);

        expect(
            getChatComposerStatus({lastMessage, retryWaitEndsAt: NOW + 20_000, now: NOW})
        ).toMatchObject({type: 'waitingToRetry', action: 'cancelRetry', retryInMs: 20_000});
        expect(getChatComposerStatus({lastMessage, canRetry: true, now: NOW})).toMatchObject({
            type: 'failed',
            action: 'tryAgain'
        });
    });

    it('offers Discard for a restored draft', () => {
        expect(getChatComposerStatus({draftSavedAt: NOW})).toMatchObject({
            type: 'draftRestored',
            action: 'discardDraft',
            draftSavedAt: NOW
        });
    });
});

describe('ChatComposerModel status', () => {
    beforeAll(() => initTestAppAsync());

    it('records a server that marks a failure unsafe to retry, and offers Refresh Status', async () => {
        const chatModel = createChatModel(
            [errorEvents('The write may have run.', 'tool_failed', {retrySafe: false})],
            {historyMode: 'server'}
        );
        chatModel.setStatusRefresher(async () => {});

        await chatModel.sendAsync('Add the note');

        expect(chatModel.lastMessage.metadata.retrySafe).toBe(false);
        expect(chatModel.composerModel.getStatus()).toMatchObject({
            type: 'failed',
            action: 'refreshStatus',
            isRetrySafe: false
        });
    });

    it('offers Refresh Status when a server-mode stream breaks after the run started', async () => {
        const chatModel = createChatModel([], {
            historyMode: 'server',
            transport: failingTransport(new Error('Network connection was reset.'), [
                {type: 'RUN_STARTED', threadId: 't1', runId: 'r1'},
                ...textEvents('Adding the note')
            ])
        });
        chatModel.setStatusRefresher(async () => {});

        await chatModel.sendAsync('Add the note');

        expect(chatModel.lastMessage.metadata.errorCode).toBe('connection-lost');
        expect(chatModel.composerModel.getStatus()).toMatchObject({
            type: 'failed',
            action: 'refreshStatus',
            isRetrySafe: false
        });
    });

    it('records no lost connection in client mode, so a request that fails at once reads as not sent', async () => {
        const chatModel = createChatModel([], {
            transport: failingTransport(new Error('Network unreachable.'))
        });

        await chatModel.sendAsync('Add the note');

        expect(chatModel.lastMessage.metadata.errorCode).toBeUndefined();
    });

    it('keeps a failure before the request went retry-safe, as with a token that could not be had', async () => {
        const chatModel = createChatModel([], {
            historyMode: 'server',
            transport: new SseChatTransport({
                url: 'https://agents.example/run',
                headers: async () => {
                    throw new Error('Your authentication has expired.');
                }
            })
        });
        chatModel.setStatusRefresher(async () => {});

        await chatModel.sendAsync('Add the note');

        expect(chatModel.lastMessage.metadata.errorCode).toBeUndefined();
        expect(chatModel.composerModel.getStatus()).toMatchObject({
            action: 'tryAgain',
            isRetrySafe: true
        });
    });

    it('still records a lost connection for a request that went out, then failed', async () => {
        hoistCore.route('POST', 'agent', () => hoistError(503, {message: 'Agent unavailable.'}));
        const chatModel = createChatModel([], {
            historyMode: 'server',
            transport: new SseChatTransport({url: 'agent'})
        });
        chatModel.setStatusRefresher(async () => {});

        await chatModel.sendAsync('Add the note');

        expect(chatModel.lastMessage.metadata.errorCode).toBe('connection-lost');
        expect(chatModel.composerModel.getStatus()).toMatchObject({action: 'refreshStatus'});
    });

    it('keeps a request the server refused retry-safe', async () => {
        const refused = Object.assign(new Error('Bad request.'), {httpStatus: 400}),
            chatModel = createChatModel([], {
                historyMode: 'server',
                transport: failingTransport(refused)
            });
        chatModel.setStatusRefresher(async () => {});

        await chatModel.sendAsync('Add the note');

        expect(chatModel.lastMessage.metadata.errorCode).toBeUndefined();
        expect(chatModel.composerModel.getStatus()).toMatchObject({
            action: 'tryAgain',
            isRetrySafe: true
        });
    });

    it('can refresh only once a thread layer supplies a refresher', async () => {
        const chatModel = createChatModel([textEvents('Hi.')]),
            refresh = vi.fn(async () => {});
        expect(chatModel.canRefreshStatus).toBe(false);
        expect(chatModel.composerModel.canRefreshStatus).toBe(false);

        chatModel.setStatusRefresher(refresh);
        await chatModel.refreshStatusAsync();

        expect(chatModel.composerModel.canRefreshStatus).toBe(true);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    describe('retry wait', () => {
        it('disables Send for the wait the server asks for, then marks the turn due', async () => {
            vi.useFakeTimers();
            const chatModel = createChatModel([
                    errorEvents('Already being handled.', 'duplicate_in_progress', {
                        retryAfterSeconds: 30
                    })
                ]),
                composer = chatModel.composerModel;

            await sendAndSettleAsync(chatModel, 'Hi');
            composer.text = 'Next question';

            expect(composer.retryWait?.messageId).toBe(chatModel.lastMessage.id);
            expect(composer.canSend).toBe(false);
            expect(composer.sendDisabledReason).toBe('Waiting to retry');
            expect(composer.getStatus()).toMatchObject({type: 'waitingToRetry'});

            await vi.advanceTimersByTimeAsync(30_000);

            expect(composer.retryWait).toBeNull();
            expect(composer.retryDueId).toBe(chatModel.lastMessage.id);
            expect(composer.canSend).toBe(true);
        });

        it('records when the failed turn ended, to count the wait from', async () => {
            vi.useFakeTimers();
            const chatModel = createChatModel([
                errorEvents('Already being handled.', 'duplicate_in_progress', {
                    retryAfterSeconds: 30
                })
            ]);

            await sendAndSettleAsync(chatModel, 'Hi');

            expect(chatModel.lastMessage.metadata.endedAt).toBeLessThanOrEqual(Date.now());
            expect(chatModel.lastMessage.metadata.endedAt).toBeGreaterThan(Date.now() - 1000);
        });

        it('stops the wait on Cancel, and offers Try Again', async () => {
            vi.useFakeTimers();
            const chatModel = createChatModel([
                    errorEvents('Already being handled.', 'duplicate_in_progress', {
                        retryAfterSeconds: 30
                    })
                ]),
                composer = chatModel.composerModel;
            await sendAndSettleAsync(chatModel, 'Hi');

            composer.cancelRetry();
            await vi.advanceTimersByTimeAsync(30_000);

            expect(composer.retryWait).toBeNull();
            expect(composer.retryDueId).toBeNull();
            expect(composer.getStatus()).toMatchObject({type: 'failed', action: 'tryAgain'});
        });

        it('never waits to retry a failure that is not retry-safe', async () => {
            const chatModel = createChatModel([
                errorEvents('Already being handled.', 'duplicate_in_progress', {
                    retryAfterSeconds: 30,
                    retrySafe: false
                })
            ]);
            await chatModel.sendAsync('Hi');

            expect(chatModel.composerModel.retryWait).toBeNull();
            expect(chatModel.composerModel.getStatus().type).toBe('failed');
        });

        it('never waits to retry over a host that cannot retry', () => {
            const composer = new ChatComposerModel({
                host: {
                    isBusy: false,
                    sendAsync: async () => {},
                    lastMessage: failed({retryAfterSeconds: 30}, Date.now())
                } as ChatComposerHost
            });
            onTestFinished(() => composer.destroy());

            expect(composer.retryWait).toBeNull();
        });
    });

    describe('offline', () => {
        it('keeps the draft and disables Send while the browser is offline', () => {
            const chatModel = createChatModel([textEvents('Hi.')]),
                composer = chatModel.composerModel;
            composer.text = 'Hello';

            window.dispatchEvent(new Event('offline'));
            expect(composer.canSend).toBe(false);
            expect(composer.sendDisabledReason).toBe("You're offline");
            expect(composer.getStatus().type).toBe('offline');
            expect(composer.text).toBe('Hello');

            window.dispatchEvent(new Event('online'));
            expect(composer.canSend).toBe(true);
            expect(composer.getStatus()).toBeNull();
        });
    });
});

//------------------
// Helpers
//------------------
function reply(spec: Partial<ChatMessageSpec> = {}): ChatMessage {
    return new ChatMessage({role: 'assistant', content: 'Partial', ...spec});
}

function failed(metadata: Record<string, any> = {}, createdAt?: number): ChatMessage {
    return reply({status: 'error', error: 'Model timed out.', metadata, createdAt});
}

function streaming(): ChatMessage {
    return reply({status: 'streaming'});
}

function complete(): ChatMessage {
    return reply({status: 'complete'});
}

function detached(): ChatMessage {
    return reply({status: 'aborted', metadata: {detached: true}});
}

function createChatModel(responses: ChatEvent[][], config: Partial<ChatModelConfig> = {}) {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({responses, delayMs: 0}),
        composer: {drafts: 'memory'},
        ...config
    });
    onTestFinished(() => model.destroy());
    return model;
}

/** A transport that sends some events, then throws. */
function failingTransport(error: Error, events: ChatEvent[] = []): ChatTransport {
    return {
        async *run() {
            yield* events;
            throw error;
        }
    };
}

async function sendAndSettleAsync(chatModel: ChatModel, text: string) {
    const done = chatModel.sendAsync(text);
    await vi.advanceTimersByTimeAsync(100);
    await done;
}
