import {act, fireEvent, render, screen} from '@testing-library/react';
import {HoistModel, XH} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {omit} from 'lodash';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    chatAnnouncer,
    type ChatFeedback,
    type ChatFeedbackDraft,
    type ChatFeedbackHost,
    type ChatFeedbackSpec,
    ChatMessage,
    type ChatMessageStatus,
    ChatModel
} from '../../../core';
import {ScriptedChatTransport} from '../../../transport';
import {chatFeedbackControls} from './ChatFeedbackControls';

/**
 * The feedback controls on their own, over a conversation that is not a `ChatModel`. An app that
 * runs its conversation elsewhere relies on each rating reaching its submitter as a complete
 * `ChatFeedbackSpec`, on the new rating showing while it saves and reverting if the save fails,
 * and on the comment form behaving as it does in the message view.
 */
describe('ChatFeedbackControls', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        const handleException = vi.spyOn(XH, 'handleException').mockImplementation(() => {});
        onTestFinished(() => handleException.mockRestore());
        chatAnnouncer.clear();
    });

    it('rates a reply through the host, with every field of the spec', async () => {
        const host = createHost();
        renderControls(host);

        await clickThumb('Good response');
        expect(host.submitFeedbackAsync).toHaveBeenCalledExactlyOnceWith({
            threadId: 'thread-1',
            messageId: 'a1',
            serverId: 'srv-1',
            runId: 'run-1',
            rating: 'positive',
            comment: null
        });
        expect(thumb('Good response').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByText('Thanks')).toBeTruthy();
    });

    it('shows the new rating while it saves, and the saved one again if the save fails', async () => {
        let fail: (e: Error) => void;
        const host = createHost();
        host.submitFeedbackAsync.mockImplementationOnce(
            () => new Promise<void>((_, reject) => (fail = reject))
        );
        renderControls(host);

        await clickThumb('Good response');
        expect(thumb('Good response').getAttribute('aria-pressed')).toBe('true');

        await act(async () => fail(new Error('Gateway timeout')));
        expect(thumb('Good response').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByText("Couldn't save rating")).toBeTruthy();
    });

    it('opens the comment form on a thumbs down, and sends the comment as an update', async () => {
        const host = createHost();
        renderControls(host);

        await clickThumb('Bad response');
        expect(host.submitFeedbackAsync).toHaveBeenLastCalledWith(
            expect.objectContaining({rating: 'negative', comment: null})
        );

        typeComment('Uses yesterday’s limits.');
        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Send Feedback'})));
        expect(host.submitFeedbackAsync).toHaveBeenLastCalledWith(
            expect.objectContaining({rating: 'negative', comment: 'Uses yesterday’s limits.'})
        );
        expect(commentField()).toBeNull();
        expect(screen.getByLabelText('Your comment: Uses yesterday’s limits.')).toBeTruthy();
    });

    it('keeps the draft in the host when the host keeps drafts', async () => {
        const host = createHost({keepsDrafts: true}),
            first = renderControls(host);

        await clickThumb('Bad response');
        typeComment('Half a thought');
        expect(host.feedbackDrafts.a1?.comment).toBe('Half a thought');

        // A new mount of the controls finds the comment again.
        first.unmount();
        renderControls(host);
        expect((commentField() as HTMLTextAreaElement).value).toBe('Half a thought');
    });

    it('keeps one form open per host, even with no host drafts', async () => {
        const host = createHost();
        renderControls(host, reply('complete', 'a1'));
        renderControls(host, reply('complete', 'a2'));

        await act(() => fireEvent.click(screen.getAllByRole('button', {name: 'Bad response'})[0]));
        typeComment('Half a thought');
        await act(() => fireEvent.click(screen.getAllByRole('button', {name: 'Bad response'})[1]));

        expect(document.querySelectorAll('.xh-chat-message__feedback')).toHaveLength(1);
        expect(
            screen.getAllByRole('button', {name: 'Bad response'})[1].getAttribute('aria-pressed')
        ).toBe('false');
    });

    it('drops a draft the kit keeps when its controls unmount, so it blocks no other reply', async () => {
        const host = createHost(),
            first = renderControls(host, reply('complete', 'a1'));
        renderControls(host, reply('complete', 'a2'));

        await act(() => fireEvent.click(screen.getAllByRole('button', {name: 'Bad response'})[0]));
        typeComment('Half a thought');
        first.unmount();

        await clickThumb('Bad response');
        expect(thumb('Bad response').getAttribute('aria-pressed')).toBe('true');
        expect(commentField()).toBeTruthy();
    });

    it('renders nothing for a message the user cannot rate', () => {
        const host = createHost(),
            {container} = renderControls(host, reply('streaming')),
            question = render(
                chatFeedbackControls({
                    message: new ChatMessage({id: 'u1', role: 'user', content: 'Why?'}),
                    host
                })
            );
        expect(container.innerHTML).toBe('');
        expect(question.container.innerHTML).toBe('');
    });

    it('takes a ChatModel as its host, and renders nothing for one that takes no feedback', async () => {
        const submitAsync = vi.fn(async (_spec: ChatFeedbackSpec) => {}),
            chatModel = createChatModel({submitAsync});
        render(chatFeedbackControls({message: chatModel.messages[1], host: chatModel}));

        await clickThumb('Good response');
        expect(submitAsync).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({threadId: chatModel.threadId, messageId: 'a1'})
        );
        expect(chatModel.messages[1].metadata.feedback).toEqual({rating: 'positive'});

        const silent = createChatModel(),
            {container} = render(chatFeedbackControls({message: silent.messages[1], host: silent}));
        expect(container.innerHTML).toBe('');
    });
});

//------------------
// Helpers
//------------------
class TestFeedbackHost extends HoistModel implements ChatFeedbackHost {
    readonly threadId = 'thread-1';

    @observableRef accessor saved: Record<string, ChatFeedback> = {};
    @observableRef accessor drafts: Record<string, ChatFeedbackDraft> = {};

    readonly submitFeedbackAsync = vi.fn(async (spec: ChatFeedbackSpec) => this.save(spec));

    constructor(readonly keepsDrafts: boolean) {
        super();
    }

    getFeedback(message: ChatMessage): ChatFeedback {
        return this.saved[message.id] ?? null;
    }

    get feedbackDrafts(): Record<string, ChatFeedbackDraft> {
        return this.keepsDrafts ? this.drafts : undefined;
    }

    @action
    setFeedbackDraft(messageId: string, draft: ChatFeedbackDraft) {
        this.drafts = draft ? {...this.drafts, [messageId]: draft} : omit(this.drafts, messageId);
    }

    @action
    private save({messageId, rating, comment}: ChatFeedbackSpec) {
        this.saved = rating
            ? {...this.saved, [messageId]: {rating, ...(comment ? {comment} : {})}}
            : omit(this.saved, messageId);
    }
}

function createHost({keepsDrafts = false}: {keepsDrafts?: boolean} = {}): TestFeedbackHost {
    const ret = new TestFeedbackHost(keepsDrafts);
    onTestFinished(() => ret.destroy());
    return ret;
}

function createChatModel(feedback = {}): ChatModel {
    const ret = new ChatModel({
        transport: new ScriptedChatTransport(),
        initialMessages: [
            {id: 'u1', role: 'user', content: 'What is the limit?'},
            {id: 'a1', role: 'assistant', content: 'Answer'}
        ],
        feedback
    });
    onTestFinished(() => ret.destroy());
    return ret;
}

function reply(status: ChatMessageStatus = 'complete', id: string = 'a1'): ChatMessage {
    return new ChatMessage({
        id,
        role: 'assistant',
        content: 'HY Credit is over its limit.',
        status,
        metadata: {serverId: 'srv-1', runId: 'run-1'}
    });
}

function renderControls(host: ChatFeedbackHost, message: ChatMessage = reply()) {
    return render(chatFeedbackControls({message, host}));
}

function thumb(name: string): HTMLElement {
    return screen.getByRole('button', {name});
}

async function clickThumb(name: string) {
    await act(() => fireEvent.click(thumb(name)));
}

function commentField(): HTMLElement {
    return document.querySelector('.xh-chat-message__feedback textarea');
}

function typeComment(value: string) {
    fireEvent.change(commentField(), {target: {value}});
}
