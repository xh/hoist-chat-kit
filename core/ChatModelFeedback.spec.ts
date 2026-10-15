import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ScriptedChatTransport} from '../transport';
import type {ChatFeedbackSpec} from './ChatFeedback';
import type {ChatMessageSpec} from './ChatMessage';
import {ChatModel, type ChatModelConfig} from './ChatModel';

/**
 * Feedback and paged history on a ChatModel. A rating must show at once and revert if the
 * backend rejects it, without undoing a newer rating, and must reach the backend with the ids it
 * keys on. Older pages of a thread must slot in ahead of the conversation without duplicates.
 */
describe('ChatModel feedback and paged history', () => {
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
                comment: 'Out of date.',
                reasons: null
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

        it('sends and records the reasons the user picked, and null for none', async () => {
            const submitAsync = vi.fn(async () => {}),
                model = createModel({
                    feedback: {submitAsync, reasons: ['Wrong data', 'Incomplete']}
                });

            await model.submitFeedbackAsync('a1', 'negative', 'Old limits.', ['Wrong data']);
            expect(submitAsync).toHaveBeenLastCalledWith(
                expect.objectContaining({comment: 'Old limits.', reasons: ['Wrong data']})
            );
            expect(model.getMessage('a1').metadata.feedback).toEqual({
                rating: 'negative',
                comment: 'Old limits.',
                reasons: ['Wrong data']
            });

            await model.submitFeedbackAsync('a1', 'positive', null, []);
            expect(submitAsync).toHaveBeenLastCalledWith(
                expect.objectContaining({rating: 'positive', reasons: null})
            );
            expect(model.getMessage('a1').metadata.feedback).toEqual({rating: 'positive'});
        });

        it('takes reasons alone as no comment, where a comment is required', async () => {
            const model = createModel({
                feedback: {submitAsync: async () => {}, requireComment: true, reasons: ['Other']}
            });

            await expect(
                model.submitFeedbackAsync('a1', 'negative', null, ['Other'])
            ).rejects.toThrow('comment is required');
        });

        it('refuses to clear a rating when the backend cannot remove one', async () => {
            const model = createModel({feedback: {submitAsync: async () => {}, clearable: false}});

            await expect(model.submitFeedbackAsync('a1', null)).rejects.toThrow('cannot clear');
            expect(model.getMessage('a1').metadata.feedback).toEqual({rating: 'positive'});
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

    describe('prependMessages', () => {
        it('adds older messages ahead of the conversation, skipping those already present', () => {
            const model = createModel();

            model.prependMessages([
                {id: 'u0', role: 'user', content: 'Older'},
                {id: 'a0', role: 'assistant', content: 'Older reply'},
                {id: 'u1', role: 'user', content: 'Duplicate'}
            ]);
            model.hasOlderMessages = true;

            expect(model.messages.map(it => it.id)).toEqual(['u0', 'a0', 'u1', 'a1']);
            expect(model.messages[2].text).toBe('Question');
            expect(model.hasOlderMessages).toBe(true);
        });

        it('closes a paused turn among older messages', () => {
            const model = createModel();

            model.prependMessages([
                {id: 'u0', role: 'user', content: 'Older'},
                {id: 'a0', role: 'assistant', status: 'paused', parts: []}
            ]);

            expect(model.getMessage('a0').status).toBe('complete');
        });

        it('resets hasOlderMessages when another thread loads', () => {
            const model = createModel();
            model.hasOlderMessages = true;

            model.loadMessages([], 'thread-2');

            expect(model.hasOlderMessages).toBe(false);
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
