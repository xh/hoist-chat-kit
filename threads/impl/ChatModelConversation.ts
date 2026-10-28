import {cloneDeep, findLast} from 'lodash';
import {HoistBase, managed} from '@xh/hoist/core';
import {action} from '@xh/hoist/mobx';
import {type ChatModel, getChatReplyStatus} from '../../core';
import type {ChatConversation} from '../ChatConversation';
import type {ChatMessagePage, ChatThreadStore} from '../ChatThreadStore';
import type {ChatThreadEndedEarly} from '../ChatThreadsModel';
import type {ChatModelDrafts} from './ChatModelDrafts';
import {titleFromText} from './threadUtils';

/** Configuration for a {@link ChatModelConversation}. */
export interface ChatModelConversationConfig {
    chatModel: ChatModel;
    store: ChatThreadStore;
    drafts: ChatModelDrafts;

    /** Why the thread holds back sends, or null - see `ChatModel.addSendBlocker`. */
    getSendBlockedReason: () => string;

    /** Reload the thread's history for Refresh Status - see `ChatModel.setStatusRefresher`. */
    refreshStatusAsync: () => Promise<void>;
}

/**
 * The kit's own conversation of a thread: a `ChatModel` from `createChatModel`, wired to the
 * threads model and its store. It loads the thread's history from the store, keeps the thread's
 * drafts and feedback comments across closes, and holds back sends while the history loads.
 * @internal
 */
export class ChatModelConversation extends HoistBase implements ChatConversation {
    @managed readonly chatModel: ChatModel;

    get threadId(): string {
        return this.chatModel.threadId;
    }

    get isBusy(): boolean {
        return this.chatModel.isBusy;
    }

    get isAwaitingUser(): boolean {
        return this.chatModel.isAwaitingUser;
    }

    get endedEarly(): ChatThreadEndedEarly {
        return getEndedEarly(this.chatModel);
    }

    get title(): string {
        return titleFromText(findLast(this.chatModel.messages, it => it.isUser)?.text);
    }

    constructor({
        chatModel,
        store,
        drafts,
        getSendBlockedReason,
        refreshStatusAsync
    }: ChatModelConversationConfig) {
        super();
        this.chatModel = chatModel;
        this.store = store;
        this.drafts = drafts;

        if (store.submitFeedbackAsync && !chatModel.feedback.submitAsync) {
            chatModel.setFeedbackSubmitter((spec, message) =>
                store.submitFeedbackAsync(spec, message)
            );
        }
        chatModel.addSendBlocker(getSendBlockedReason);
        chatModel.setStatusRefresher(refreshStatusAsync);
        drafts.open(chatModel.threadId, chatModel);
    }

    /**
     * Load the thread's history from the store. The result applies only if this is the latest
     * load, and the chat still holds the thread - an app may clear the chat, or load other
     * messages into it, while the load runs.
     */
    async loadAsync(): Promise<void> {
        const {chatModel} = this,
            {threadId} = chatModel,
            loadNumber = ++this.loadCount,
            page = await this.store.loadMessagesAsync({threadId});
        if (this.isDestroyed || loadNumber !== this.loadCount) return;
        if (chatModel.threadId === threadId) this.applyHistory(threadId, page);
    }

    stop() {
        this.chatModel.stop();
    }

    /** Stop following the running turn, which the server may finish. */
    detach() {
        this.chatModel.detach();
    }

    /** Keep the draft and feedback comments of a thread, as its chat closes. */
    saveDraft(threadId: string) {
        this.drafts.save(threadId, this.chatModel);
    }

    /**
     * True if the last turn reached the backend's run: its reply has content, is paused for the
     * user, or recorded the run's id from `RUN_STARTED`.
     */
    get hasRunStarted(): boolean {
        const reply = this.chatModel.lastMessage;
        if (!reply?.isAssistant) return false;
        return reply.status === 'paused' || reply.parts.length > 0 || reply.metadata.runId != null;
    }

    //------------------
    // Implementation
    //------------------
    private readonly store: ChatThreadStore;
    private readonly drafts: ChatModelDrafts;
    private loadCount = 0;

    @action
    private applyHistory(threadId: string, page: ChatMessagePage) {
        const {chatModel, drafts} = this;
        drafts.loadHistory(chatModel, threadId, page.messages ?? []);
        // TODO(design-open B4) - run options, such as a document scope, belong to the thread.
        // The thread opens with those of its last question, unless the user changed them here.
        const lastRunOptions = findLast(chatModel.messages, it => it.isUser)?.metadata.runOptions;
        if (lastRunOptions != null && drafts.hasDefaultRunOptions(chatModel)) {
            chatModel.runOptions = cloneDeep(lastRunOptions);
        }
    }
}

/** How a chat's last turn ended early - failed, or cut short by the server - or null. */
function getEndedEarly(chatModel: ChatModel): ChatThreadEndedEarly {
    if (chatModel.status !== 'error') return null;
    const replyStatus = getChatReplyStatus({message: chatModel.lastMessage}),
        isCutShort = replyStatus === 'interrupted' || replyStatus === 'cancelledByServer';
    return {
        runEnd: isCutShort ? 'interrupted' : 'failed',
        reason: chatModel.lastError?.message ?? null
    };
}
