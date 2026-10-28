import {act, fireEvent, render, screen} from '@testing-library/react';
import {HoistModel, XH} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {action, observableRef} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {omit} from 'lodash';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    chatAnnouncer,
    type ChatFeedback,
    type ChatFeedbackDraft,
    type ChatFeedbackHost,
    type ChatFeedbackSettings,
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

    it('rates a reply through the host, with every field of the spec and the message', async () => {
        const host = createHost(),
            message = reply();
        renderControls(host, message);

        await clickThumb('Good response');
        expect(host.submitFeedbackAsync).toHaveBeenCalledExactlyOnceWith(
            {
                threadId: 'thread-1',
                messageId: 'a1',
                serverId: 'srv-1',
                runId: 'run-1',
                rating: 'positive',
                comment: null
            },
            message
        );
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
            expect.objectContaining({rating: 'negative', comment: null}),
            expect.anything()
        );

        typeComment('Uses yesterday’s limits.');
        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Send Feedback'})));
        expect(host.submitFeedbackAsync).toHaveBeenLastCalledWith(
            expect.objectContaining({rating: 'negative', comment: 'Uses yesterday’s limits.'}),
            expect.anything()
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
            expect.objectContaining({threadId: chatModel.threadId, messageId: 'a1'}),
            expect.anything()
        );
        expect(chatModel.messages[1].metadata.feedback).toEqual({rating: 'positive'});

        const silent = createChatModel(),
            {container} = render(chatFeedbackControls({message: silent.messages[1], host: silent}));
        expect(container.innerHTML).toBe('');
    });

    it('locks a saved rating with allowChange false, and still takes a comment on it', async () => {
        const host = createHost({feedbackSettings: {allowChange: false}});
        renderControls(host);

        await clickThumb('Good response');
        expect(thumb('Bad response').hasAttribute('disabled')).toBe(true);
        await clickThumb('Good response');
        expect(host.submitFeedbackAsync).toHaveBeenCalledOnce();
        expect(thumb('Good response').getAttribute('aria-pressed')).toBe('true');

        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Add a comment'})));
        typeComment('Clear and correct.');
        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Send Comment'})));
        expect(host.submitFeedbackAsync).toHaveBeenLastCalledWith(
            expect.objectContaining({rating: 'positive', comment: 'Clear and correct.'}),
            expect.anything()
        );
    });

    it('locks a rating restored from history, and leaves the thumbs free until a save succeeds', async () => {
        const restored = createHost({feedbackSettings: {allowChange: false}});
        restored.saved = {a1: {rating: 'negative'}};
        const view = renderControls(restored);
        expect(thumb('Good response').hasAttribute('disabled')).toBe(true);
        view.unmount();

        const host = createHost({feedbackSettings: {allowChange: false}});
        host.submitFeedbackAsync.mockRejectedValueOnce(new Error('Gateway timeout'));
        renderControls(host);
        await clickThumb('Good response');
        expect(thumb('Bad response').hasAttribute('disabled')).toBe(false);

        await clickThumb('Bad response');
        expect(host.submitFeedbackAsync).toHaveBeenLastCalledWith(
            expect.objectContaining({rating: 'negative'}),
            expect.anything()
        );
    });

    it("leads the bar with the app's items, and keeps them while the reply cannot be rated", () => {
        const host = createHost(),
            copy = () => button({text: 'Copy answer'}),
            first = render(chatFeedbackControls({message: reply(), host, items: [copy()]}));

        const bar = screen.getByRole('group', {name: 'Message actions'});
        expect(bar.firstElementChild.textContent).toBe('Copy answer');
        expect(first.container.querySelector('.xh-chat-feedback-controls__sep')).toBeTruthy();
        expect(thumb('Good response')).toBeTruthy();

        first.unmount();

        const streaming = render(
            chatFeedbackControls({message: reply('streaming', 'a2'), host, items: [copy()]})
        );
        expect(streaming.getByRole('button', {name: 'Copy answer'})).toBeTruthy();
        expect(streaming.queryByRole('button', {name: 'Good response'})).toBeNull();
        expect(streaming.container.querySelector('.xh-chat-feedback-controls__sep')).toBeNull();
    });

    it('caps the comment at maxCommentLength with a counter, or takes any length for null', async () => {
        const submitAsync = vi.fn(async (_spec: ChatFeedbackSpec) => {}),
            capped = createChatModel({submitAsync}),
            cappedView = render(chatFeedbackControls({message: capped.messages[1], host: capped}));
        await clickThumb('Bad response');
        expect(commentField().getAttribute('maxlength')).toBe('1000');
        typeComment('x'.repeat(950));
        expect(screen.getByText('950 / 1,000')).toBeTruthy();
        cappedView.unmount();

        const open = createChatModel({submitAsync, maxCommentLength: null});
        render(chatFeedbackControls({message: open.messages[1], host: open}));
        await clickThumb('Bad response');
        expect(commentField().hasAttribute('maxlength')).toBe(false);
        typeComment('x'.repeat(5000));
        expect(screen.queryByText(/ \/ /)).toBeNull();
        expect(screen.getByText('Ctrl/Cmd+Enter sends')).toBeTruthy();
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

    constructor(
        readonly keepsDrafts: boolean,
        readonly feedbackSettings: ChatFeedbackSettings
    ) {
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

function createHost({
    keepsDrafts = false,
    feedbackSettings = null
}: {keepsDrafts?: boolean; feedbackSettings?: ChatFeedbackSettings} = {}): TestFeedbackHost {
    const ret = new TestFeedbackHost(keepsDrafts, feedbackSettings);
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
