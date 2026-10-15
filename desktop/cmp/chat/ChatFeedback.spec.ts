import {act, fireEvent, render, screen} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, type Mock, onTestFinished, vi} from 'vitest';
import {
    chatAnnouncer,
    type ChatFeedbackConfig,
    type ChatFeedbackSpec,
    type ChatMessageSpec,
    ChatModel
} from '../../../core';
import {ScriptedChatTransport} from '../../../transport';
import {chatMessageList} from './ChatMessageList';

/**
 * Feedback on a reply, inline under its action bar. A backend that requires a comment on a down
 * vote relies on the rating saving only with its comment, and on a failure keeping the comment,
 * with Retry, never a toast. Users rely on Cancel restoring the earlier rating, on one form open
 * per thread, and on a reload restoring the rating without inventing a comment.
 */
describe('ChatMessageView feedback', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
        const handleException = vi.spyOn(XH, 'handleException').mockImplementation(() => {});
        onTestFinished(() => handleException.mockRestore());
        chatAnnouncer.clear();
    });

    describe('a down vote that requires a comment', () => {
        const REQUIRED: ChatFeedbackConfig = {
            requireComment: true,
            clearable: false,
            reasons: ['Wrong data', 'Incomplete']
        };

        it('saves nothing until a comment is sent, and reasons alone never enable Send', async () => {
            const {submitAsync} = renderChat(REQUIRED);

            await clickThumb('Bad response');
            expect(submitAsync).not.toHaveBeenCalled();
            expect(thumb('Bad response').getAttribute('aria-pressed')).toBe('true');
            expect(document.activeElement).toBe(commentField());
            expect(screen.getByText('Comment required')).toBeTruthy();
            expect(screen.getByText('Not saved until you send')).toBeTruthy();

            fireEvent.click(screen.getByRole('button', {name: 'Wrong data'}));
            expect(
                screen.getByRole('button', {name: 'Wrong data'}).getAttribute('aria-pressed')
            ).toBe('true');
            expect(sendButton().disabled).toBe(true);

            typeComment('Uses yesterday’s limits.');
            expect(sendButton().disabled).toBe(false);
            await act(() => fireEvent.keyDown(commentField(), {key: 'Enter', ctrlKey: true}));

            expect(submitAsync).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    rating: 'negative',
                    comment: 'Uses yesterday’s limits.',
                    reasons: ['Wrong data']
                })
            );
            expect(screen.queryByRole('group', {name: 'What went wrong?'})).toBeNull();
            expect(screen.getByText('Thanks, feedback sent')).toBeTruthy();
            expect(screen.getByText('Wrong data')).toBeTruthy();
            await settle();
            expect(document.activeElement).toBe(thumb('Bad response'));
        });

        it('keeps the comment on a failed send, and Retry sends the same payload', async () => {
            const submitAsync = vi
                .fn<(spec: ChatFeedbackSpec) => Promise<void>>()
                .mockRejectedValueOnce(new Error('Gateway timeout'))
                .mockResolvedValue(undefined);
            renderChat({...REQUIRED, submitAsync});

            await clickThumb('Bad response');
            typeComment('Out of date.');
            await act(() => fireEvent.click(sendButton()));

            expect(formError().textContent).toBe("Couldn't send feedback. Your comment is kept.");
            expect((commentField() as HTMLTextAreaElement).value).toBe('Out of date.');
            expect(thumb('Bad response').getAttribute('aria-pressed')).toBe('true');
            expect(chatAnnouncer.assertive?.text).toBe('Feedback not sent. Your comment is kept.');
            await settle();
            const retry = screen.getByRole('button', {name: 'Retry'});
            expect(document.activeElement).toBe(retry);

            await act(() => fireEvent.click(retry));
            expect(submitAsync).toHaveBeenCalledTimes(2);
            expect(submitAsync.mock.calls[1][0]).toEqual(submitAsync.mock.calls[0][0]);
            expect(screen.queryByRole('group', {name: 'What went wrong?'})).toBeNull();
        });

        it("shows the server's reason for a rejected comment, with no Retry", async () => {
            const rejection = Object.assign(new Error('Comment is too long.'), {httpStatus: 400}),
                submitAsync = vi.fn(() => Promise.reject(rejection));
            renderChat({...REQUIRED, submitAsync});

            await clickThumb('Bad response');
            typeComment('Far too long.');
            await act(() => fireEvent.click(sendButton()));

            expect(formError()?.textContent).toBe('Comment is too long.');
            expect(chatAnnouncer.assertive?.text).toBe('Comment is too long.');
            expect(screen.queryByRole('button', {name: 'Retry'})).toBeNull();
            expect(sendButton().disabled).toBe(true);

            typeComment('Shorter.');
            expect(formError()).toBeNull();
            expect(sendButton().disabled).toBe(false);
        });

        it('restores the earlier rating on Cancel or Escape, and refocuses the thumb', async () => {
            const {submitAsync} = renderChat(REQUIRED, {feedback: {rating: 'positive'}});

            await clickThumb('Bad response');
            expect(thumb('Good response').getAttribute('aria-pressed')).toBe('false');
            fireEvent.keyDown(commentField(), {key: 'Escape'});

            expect(screen.queryByRole('group', {name: 'What went wrong?'})).toBeNull();
            expect(thumb('Good response').getAttribute('aria-pressed')).toBe('true');
            expect(thumb('Bad response').getAttribute('aria-pressed')).toBe('false');
            expect(submitAsync).not.toHaveBeenCalled();
            await settle();
            expect(document.activeElement).toBe(thumb('Bad response'));

            await clickThumb('Bad response');
            fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
            expect(thumb('Good response').getAttribute('aria-pressed')).toBe('true');
        });

        it('disables the thumbs and the form while sending, with no Cancel', async () => {
            let resolve: () => void;
            const submitAsync = vi.fn(() => new Promise<void>(it => (resolve = it)));
            renderChat({...REQUIRED, submitAsync});

            await clickThumb('Bad response');
            typeComment('Wrong desk.');
            fireEvent.click(sendButton());

            expect(screen.getByRole('button', {name: 'Sending…'})).toBeTruthy();
            expect((commentField() as HTMLTextAreaElement).disabled).toBe(true);
            expect(thumb('Good response').hasAttribute('disabled')).toBe(true);
            expect(screen.queryByRole('button', {name: 'Cancel'})).toBeNull();

            await act(async () => resolve());
        });
    });

    describe('an up vote', () => {
        it('saves at once, thanks the user, and offers a comment until the next send', async () => {
            const {submitAsync, chatModel} = renderChat({});

            await clickThumb('Good response');
            expect(submitAsync).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({rating: 'positive', comment: null})
            );
            expect(screen.getByText('Thanks')).toBeTruthy();
            expect(screen.queryByRole('group')).toBeNull();

            fireEvent.click(screen.getByRole('button', {name: 'Add a comment'}));
            expect(screen.getByRole('group', {name: 'What worked?'})).toBeTruthy();
            expect(screen.getByText('Optional')).toBeTruthy();
            expect(screen.queryByRole('group', {name: 'Reasons'})).toBeNull();

            typeComment('Clear and quick.');
            await act(() => fireEvent.click(screen.getByRole('button', {name: 'Send Comment'})));
            expect(submitAsync).toHaveBeenLastCalledWith(
                expect.objectContaining({rating: 'positive', comment: 'Clear and quick.'})
            );

            // The link goes with the next send.
            await clickThumb('Good response');
            await clickThumb('Good response');
            expect(screen.getByRole('button', {name: 'Add a comment'})).toBeTruthy();
            act(() => {
                chatModel.loadMessages([...chatModel.messages, question('u2')]);
            });
            expect(screen.queryByRole('button', {name: 'Add a comment'})).toBeNull();
        });

        it('un-presses the thumb when the save fails, with Retry', async () => {
            const submitAsync = vi
                .fn<(spec: ChatFeedbackSpec) => Promise<void>>()
                .mockRejectedValueOnce(new Error('Server down'))
                .mockResolvedValue(undefined);
            renderChat({submitAsync});

            await clickThumb('Good response');
            expect(thumb('Good response').getAttribute('aria-pressed')).toBe('false');
            expect(screen.getByText("Couldn't save rating")).toBeTruthy();
            expect(chatAnnouncer.assertive?.text).toBe('Rating not saved.');

            await act(() => fireEvent.click(screen.getByRole('button', {name: 'Retry'})));
            expect(submitAsync).toHaveBeenCalledTimes(2);
            expect(thumb('Good response').getAttribute('aria-pressed')).toBe('true');
            expect(screen.queryByText("Couldn't save rating")).toBeNull();
        });
    });

    describe('a down vote with an optional comment', () => {
        it('saves at once and opens the form, and Cancel keeps the rating', async () => {
            const {submitAsync} = renderChat({reasons: ['Incomplete']});

            await clickThumb('Bad response');
            expect(submitAsync).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({rating: 'negative'})
            );
            expect(screen.getByText('Optional')).toBeTruthy();
            expect(screen.getByText('Your rating is already saved')).toBeTruthy();

            fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
            expect(screen.queryByRole('group', {name: 'What went wrong?'})).toBeNull();
            expect(thumb('Bad response').getAttribute('aria-pressed')).toBe('true');
        });
    });

    describe('a rating restored from history', () => {
        it('shows the chosen thumb with no comment mark, and clears on a click', async () => {
            const {submitAsync} = renderChat({}, {feedback: {rating: 'negative'}});

            const down = thumb('Bad response');
            expect(down.getAttribute('aria-pressed')).toBe('true');
            expect(document.querySelector('.xh-chat-message__feedback-note')).toBeNull();

            await clickThumb('Bad response');
            expect(submitAsync).toHaveBeenCalledWith(expect.objectContaining({rating: null}));
            expect(down.getAttribute('aria-pressed')).toBe('false');
        });

        it('stays put on a click when the backend cannot clear a rating', async () => {
            const {submitAsync} = renderChat({clearable: false}, {feedback: {rating: 'negative'}});

            await clickThumb('Bad response');
            expect(submitAsync).not.toHaveBeenCalled();
            expect(thumb('Bad response').getAttribute('aria-pressed')).toBe('true');
        });
    });

    describe('in a thread', () => {
        it('keeps one form open, holding a second thumb while the first form has a draft', async () => {
            const {submitAsync} = renderChat({requireComment: true}, {}, TWO_REPLIES);
            const [, secondDown] = screen.getAllByRole('button', {name: 'Bad response'}),
                [firstUp] = screen.getAllByRole('button', {name: 'Good response'});

            await act(() => fireEvent.click(secondDown));
            typeComment('Half done.');
            await act(() => fireEvent.click(firstUp));

            expect(submitAsync).not.toHaveBeenCalled();
            expect(screen.getAllByRole('group', {name: 'What went wrong?'})).toHaveLength(1);
            expect(
                document
                    .querySelector('[aria-label="Good response"]')
                    ?.closest('.xh-chat-message')
                    ?.classList.contains('xh-chat-message--feedback-open')
            ).toBe(false);

            // An empty form closes for the new one.
            typeComment('');
            await act(() => fireEvent.click(firstUp));
            expect(submitAsync).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({messageId: 'a1', rating: 'positive'})
            );
            expect(screen.queryByRole('group', {name: 'What went wrong?'})).toBeNull();
        });

        it('keeps a draft when the list renders again, as after a thread switch', async () => {
            const {chatModel, unmount} = renderChat({requireComment: true});

            await clickThumb('Bad response');
            typeComment('Kept for later.');
            unmount();
            render(chatMessageList({model: chatModel}));

            expect((commentField() as HTMLTextAreaElement).value).toBe('Kept for later.');
            expect(document.activeElement).not.toBe(commentField());
        });

        it('drops a pending rating when its reply is regenerated', async () => {
            const {chatModel} = renderChat({requireComment: true});
            const regenerate = vi.spyOn(chatModel, 'regenerateAsync').mockResolvedValue();

            await clickThumb('Bad response');
            typeComment('About to go.');
            fireEvent.click(screen.getByRole('button', {name: 'Regenerate'}));

            expect(regenerate).toHaveBeenCalledOnce();
            expect(screen.queryByRole('group', {name: 'What went wrong?'})).toBeNull();
            expect(thumb('Bad response').getAttribute('aria-pressed')).toBe('false');
        });
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

const TWO_REPLIES: ChatMessageSpec[] = [
    question('u1'),
    reply('a1', 'First answer'),
    question('u2'),
    reply('a2', 'Second answer')
];

function renderChat(
    feedback: ChatFeedbackConfig,
    metadata: Record<string, any> = {},
    messages: ChatMessageSpec[] = [question('u1'), {...reply('a1', 'Answer'), metadata}]
) {
    type Submitter = Mock<(spec: ChatFeedbackSpec) => Promise<void>>;
    const submitAsync = (feedback.submitAsync as Submitter) ?? (vi.fn(async () => {}) as Submitter),
        chatModel = new ChatModel({
            transport: new ScriptedChatTransport(),
            initialMessages: messages,
            feedback: {...feedback, submitAsync}
        });
    onTestFinished(() => chatModel.destroy());
    const {unmount} = render(chatMessageList({model: chatModel}));
    return {submitAsync, chatModel, unmount};
}

function question(id: string): ChatMessageSpec {
    return {id, role: 'user', content: 'What is the limit?'};
}

function reply(id: string, text: string): ChatMessageSpec {
    return {id, role: 'assistant', content: text};
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

function formError(): HTMLElement {
    return document.querySelector('.xh-chat-message__feedback-error');
}

function typeComment(value: string) {
    fireEvent.change(commentField(), {target: {value}});
}

function sendButton(): HTMLButtonElement {
    return screen.getByRole('button', {name: /^Send (Feedback|Comment)$/}) as HTMLButtonElement;
}

// Let focus moves scheduled after a render land.
async function settle() {
    await act(() => wait(10));
}
