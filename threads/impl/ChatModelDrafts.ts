import {compact, isEmpty, isEqual, uniq} from 'lodash';
import type {PlainObject} from '@xh/hoist/core';
import type {ChatFeedbackDraft, ChatMessage, ChatMessageSpec, ChatModel} from '../../core';

/**
 * What the threads model keeps of closed `ChatModel`s for the session: each thread's draft and
 * run options, its unsent feedback comments, and the run options each chat was built with.
 * @internal
 */
export class ChatModelDrafts {
    // Drafts and run options of closed threads, for when they open again.
    private readonly drafts = new Map<string, ThreadDraft>();

    // Feedback comments of closed threads, by thread id, for when their history loads again.
    private readonly feedbackDrafts = new Map<string, SavedFeedbackDraft[]>();

    // The run options each chat was built with, so that a draft keeps only the user's changes.
    private readonly defaultRunOptions = new WeakMap<ChatModel, PlainObject>();

    /** Note a new chat's run options, and give it back its thread's draft, if one was kept. */
    open(threadId: string, chatModel: ChatModel) {
        this.defaultRunOptions.set(chatModel, chatModel.runOptions ?? null);

        const draft = this.drafts.get(threadId);
        if (!draft) return;
        this.drafts.delete(threadId);
        chatModel.composerModel.text = draft.text;
        chatModel.runOptions = draft.runOptions;
    }

    /**
     * Keep the draft of a closing chat, if the user changed its text or run options, and its
     * unsent feedback comments.
     */
    save(threadId: string, chatModel: ChatModel) {
        const {composerModel, runOptions} = chatModel,
            isChanged = composerModel.text || !this.hasDefaultRunOptions(chatModel);
        if (isChanged) {
            this.drafts.set(threadId, {text: composerModel.text, runOptions});
        }

        const feedbackDrafts = getFeedbackDrafts(chatModel);
        if (!isEmpty(feedbackDrafts)) this.feedbackDrafts.set(threadId, feedbackDrafts);
    }

    /** Drop all that is kept for a thread. */
    remove(threadId: string) {
        this.drafts.delete(threadId);
        this.feedbackDrafts.delete(threadId);
    }

    /**
     * Load history into a chat, keeping its feedback comments: those of the thread when it was
     * closed, and those open in the chat, which the load clears.
     */
    loadHistory(chatModel: ChatModel, threadId: string, messages: ChatMessageSpec[]) {
        const feedbackDrafts = [
            ...(this.feedbackDrafts.get(threadId) ?? []),
            ...getFeedbackDrafts(chatModel)
        ];
        this.feedbackDrafts.delete(threadId);
        chatModel.loadMessages(messages, threadId);
        restoreFeedbackDrafts(chatModel, feedbackDrafts);
    }

    /** True if a chat still has the run options it was built with. */
    hasDefaultRunOptions(chatModel: ChatModel): boolean {
        return isEqual(chatModel.runOptions, this.defaultRunOptions.get(chatModel));
    }
}

//------------------
// Implementation
//------------------
/** A feedback comment kept for a thread, with the ids its message may come back under. */
interface SavedFeedbackDraft {
    /** The message's id when the comment was typed. */
    messageId: string;

    /** The server's id of the message, from its `metadata.serverId`, or null. */
    serverId: string;

    /** The server's ids of the message's parts. */
    partServerIds: string[];

    draft: ChatFeedbackDraft;
}

/** Draft and run options of a closed thread. */
interface ThreadDraft {
    text: string;
    runOptions: PlainObject;
}

/**
 * A chat's unsent feedback comments, with the server's ids of their messages. A comment that is
 * sending has left the form, and its send ends without the chat, so it is left out.
 */
function getFeedbackDrafts(chatModel: ChatModel): SavedFeedbackDraft[] {
    return compact(
        Object.entries(chatModel.feedbackDrafts).map(([messageId, draft]) => {
            if (draft.isSending) return null;
            const message = chatModel.getMessage(messageId);
            return {
                messageId,
                serverId: message?.metadata.serverId ?? null,
                partServerIds: message ? getPartServerIds(message) : [],
                draft
            };
        })
    );
}

/**
 * Give loaded replies back their feedback comments. A reply from history may carry the id the chat
 * streamed it under, or the server's id for it or one of its parts. The match tries each, in that
 * order, and skips a comment that more than one reply matches at the first tier that finds any.
 */
function restoreFeedbackDrafts(chatModel: ChatModel, saved: SavedFeedbackDraft[]) {
    const replies = chatModel.messages.filter(it => it.isAssistant);
    saved.forEach(({messageId, serverId, partServerIds, draft}) => {
        const isServerId = (ids: string[], message: ChatMessage) =>
                ids.includes(message.id) ||
                ids.includes(message.metadata.serverId) ||
                getPartServerIds(message).some(it => ids.includes(it)),
            tiers: Array<(message: ChatMessage) => boolean> = [
                it => it.id === messageId,
                it => serverId != null && isServerId([serverId], it),
                it => isServerId(partServerIds, it)
            ];
        for (const tier of tiers) {
            const matches = replies.filter(tier);
            if (matches.length === 1) chatModel.setFeedbackDraft(matches[0].id, draft);
            if (matches.length) return;
        }
    });
}

/** The server's ids of a message's parts. */
function getPartServerIds(message: ChatMessage): string[] {
    return uniq(compact(message.parts.map(it => ('serverId' in it ? it.serverId : null))));
}
