import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ScriptedChatTransport, textEvents} from '../transport';
import type {ChatFeedbackDraft, ChatFeedbackSpec} from './ChatFeedback';
import type {ChatMessageSpec} from './ChatMessage';
import {ChatModel, type ChatModelConfig} from './ChatModel';

/**
 * Feedback on a ChatModel. A rating must show at once and revert if the backend rejects it,
 * without undoing a newer rating, and must reach the backend with the ids it keys on.
 */
describe('ChatModel feedback', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('submitFeedbackAsync', () => {
        it('records the rating at once, and submits it with the ids the backend keys on', async () => {
            let resolve: () => void;
            const submitAsync = vi.fn(() => new Promise<void>(it => (resolve = it))),
                model = createModel({feedback: {submitAsync}});

            const done = model.submitFeedbackAsync('a1', 'negative', '  Out of date.  ');
            expect(model.getMessage('a1').metadata.feedback).toEqual({
                rating: 'negative',
                comment: 'Out of date.'
            });
            resolve();
            await done;

            expect(submitAsync).toHaveBeenCalledExactlyOnceWith({
                threadId: 'thread-1',
                messageId: 'a1',
                serverId: 'srv-a1',
                runId: 'run-a1',
                rating: 'negative',
                comment: 'Out of date.'
            } satisfies ChatFeedbackSpec);
        });

        it('rolls the rating back and records the failure, with no toast', async () => {
            const handleException = spyHandleException(),
                error = new Error('Server down'),
                submitAsync = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined),
                model = createModel({feedback: {submitAsync}});

            await model.submitFeedbackAsync('a1', 'negative');

            expect(model.getMessage('a1').metadata.feedback).toEqual({rating: 'positive'});
            expect(model.feedbackErrors).toEqual({a1: error});
            expect(handleException).toHaveBeenCalledExactlyOnceWith(
                error,
                expect.objectContaining({showAlert: false})
            );

            await model.submitFeedbackAsync('a1', 'negative');
            expect(model.feedbackErrors).toEqual({});
        });

        it('keeps a newer rating when an older submit fails', async () => {
            spyHandleException();
            let reject: (e: Error) => void;
            const submitAsync = vi
                    .fn<(spec: ChatFeedbackSpec) => Promise<void>>()
                    .mockImplementationOnce(() => new Promise((_, it) => (reject = it)))
                    .mockResolvedValue(undefined),
                model = createModel({feedback: {submitAsync}});

            const first = model.submitFeedbackAsync('a1', 'negative');
            await model.submitFeedbackAsync('a1', 'positive', 'Better now.');
            reject(new Error('Timed out'));
            await first;

            expect(model.getMessage('a1').metadata.feedback).toEqual({
                rating: 'positive',
                comment: 'Better now.'
            });
        });

        it('keeps a newer cleared rating when an older clear fails', async () => {
            spyHandleException();
            let reject: (e: Error) => void;
            const submitAsync = vi
                    .fn<(spec: ChatFeedbackSpec) => Promise<void>>()
                    .mockResolvedValueOnce(undefined)
                    .mockImplementationOnce(() => new Promise((_, it) => (reject = it)))
                    .mockResolvedValue(undefined),
                model = createModel({feedback: {submitAsync}});
            await model.submitFeedbackAsync('a1', 'positive');

            const first = model.submitFeedbackAsync('a1', null);
            await model.submitFeedbackAsync('a1', null);
            reject(new Error('Timed out'));
            await first;

            expect(model.getMessage('a1').metadata).not.toHaveProperty('feedback');
        });

        it('clears a rating with null', async () => {
            const submitAsync = vi.fn(async () => {}),
                model = createModel({feedback: {submitAsync}});

            await model.submitFeedbackAsync('a1', null);

            expect(model.getMessage('a1').metadata).not.toHaveProperty('feedback');
            expect(submitAsync).toHaveBeenCalledWith(
                expect.objectContaining({rating: null, comment: null})
            );
        });

        it('saves a thumbs down with no comment when comments are off, even with requireComment', async () => {
            const model = createModel({
                feedback: {submitAsync: async () => {}, allowComment: false, requireComment: true}
            });

            await expect(model.submitFeedbackAsync('a1', 'negative')).resolves.toBeUndefined();
            expect(model.getMessage('a1').metadata.feedback).toEqual({rating: 'negative'});
        });

        it('refuses to clear a rating when the backend cannot remove one', async () => {
            const model = createModel({feedback: {submitAsync: async () => {}, clearable: false}});

            await expect(model.submitFeedbackAsync('a1', null)).rejects.toThrow('cannot clear');
            expect(model.getMessage('a1').metadata.feedback).toEqual({rating: 'positive'});
        });

        it('refuses to change a saved rating with allowChange false, and takes a comment on it', async () => {
            const submitAsync = vi.fn(async () => {}),
                model = createModel({feedback: {submitAsync, allowChange: false}});

            await expect(model.submitFeedbackAsync('a1', 'negative')).rejects.toThrow(
                'cannot change'
            );
            await expect(model.submitFeedbackAsync('a1', null)).rejects.toThrow('cannot change');
            expect(submitAsync).not.toHaveBeenCalled();

            await model.submitFeedbackAsync('a1', 'positive', 'Clear and correct.');
            expect(model.getMessage('a1').metadata.feedback).toEqual({
                rating: 'positive',
                comment: 'Clear and correct.'
            });
        });

        it('uses the submitter a thread layer supplies when none is configured', async () => {
            const submitAsync = vi.fn(async () => {}),
                model = createModel();
            expect(model.canSubmitFeedback).toBe(false);

            model.setFeedbackSubmitter(submitAsync);
            await model.submitFeedbackAsync('a1', 'positive');

            expect(model.canSubmitFeedback).toBe(true);
            expect(submitAsync).toHaveBeenCalledOnce();
        });

        it('throws with no submitter, and for a missing required comment', async () => {
            const bare = createModel(),
                strict = createModel({
                    feedback: {submitAsync: async () => {}, requireComment: true}
                });

            await expect(bare.submitFeedbackAsync('a1', 'positive')).rejects.toThrow(
                'cannot submit feedback'
            );
            await expect(strict.submitFeedbackAsync('a1', 'negative', ' ')).rejects.toThrow(
                'comment is required'
            );
            await expect(strict.submitFeedbackAsync('a1', 'positive')).resolves.toBeUndefined();
        });

        it('tracks feedback without the comment when tracking is on', async () => {
            const track = vi.spyOn(XH, 'track').mockImplementation(() => {}),
                model = createModel({feedback: {submitAsync: async () => {}}, track: true});
            onTestFinished(() => track.mockRestore());

            await model.submitFeedbackAsync('a1', 'negative', 'Private remark');

            expect(track).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    category: 'Chat',
                    message: 'Feedback submitted',
                    data: expect.objectContaining({rating: 'negative', hasComment: true})
                })
            );
            expect(JSON.stringify(track.mock.calls)).not.toContain('Private remark');
        });
    });

    describe('feedbackDrafts', () => {
        const DRAFT: ChatFeedbackDraft = {
            rating: 'negative',
            comment: 'Half typed',
            isPending: true,
            isSending: false,
            error: null
        };

        it('keeps a draft by message, and drops it once its comment is sent', async () => {
            const model = createModel({feedback: {submitAsync: async () => {}}});

            model.setFeedbackDraft('a1', DRAFT);
            expect(model.feedbackDrafts).toEqual({a1: DRAFT});

            await model.submitFeedbackAsync('a1', 'negative');
            expect(model.feedbackDrafts).toEqual({a1: DRAFT});

            await model.submitFeedbackAsync('a1', 'negative', 'Half typed');
            expect(model.feedbackDrafts).toEqual({});
        });

        it('keeps a draft when its comment fails to send', async () => {
            spyHandleException();
            const model = createModel({
                feedback: {submitAsync: () => Promise.reject(new Error('Down'))}
            });

            model.setFeedbackDraft('a1', DRAFT);
            await model.submitFeedbackAsync('a1', 'negative', 'Half typed');

            expect(model.feedbackDrafts).toEqual({a1: DRAFT});
        });

        it('drops a draft when its message goes, and all drafts when the chat clears', async () => {
            const model = createModel({
                transport: new ScriptedChatTransport({delayMs: 0, responses: [textEvents('New')]})
            });

            model.setFeedbackDraft('a1', DRAFT);
            await model.regenerateAsync();
            expect(model.feedbackDrafts).toEqual({});

            model.setFeedbackDraft(model.lastMessage.id, DRAFT);
            model.clear();
            expect(model.feedbackDrafts).toEqual({});

            model.setFeedbackDraft('a1', DRAFT);
            model.loadMessages(HISTORY, 'thread-2');
            expect(model.feedbackDrafts).toEqual({});
        });
    });
});

//------------------
// Helpers
//------------------
const HISTORY: ChatMessageSpec[] = [
    {id: 'u1', role: 'user', content: 'Question'},
    {
        id: 'a1',
        role: 'assistant',
        content: 'Answer',
        metadata: {serverId: 'srv-a1', runId: 'run-a1', feedback: {rating: 'positive'}}
    }
];

function createModel(config: Partial<ChatModelConfig> = {}): ChatModel {
    const model = new ChatModel({
        transport: new ScriptedChatTransport({delayMs: 0}),
        threadId: 'thread-1',
        initialMessages: HISTORY,
        ...config
    });
    onTestFinished(() => model.destroy());
    return model;
}

function spyHandleException() {
    const handleException = vi.spyOn(XH, 'handleException').mockImplementation(() => {});
    onTestFinished(() => handleException.mockRestore());
    return handleException;
}
