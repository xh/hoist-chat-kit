import {HoistBase, managed} from '@xh/hoist/core';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import type {ChatModel} from '../../core';
import type {ChatConversation} from '../ChatConversation';
import {ChatModelConversation} from './ChatModelConversation';

/** State of an open thread's history. `notFound` if the store reported the thread missing. */
export type OpenThreadLoadState = 'loading' | 'loaded' | 'notFound' | 'failed';

/** Configuration for an {@link OpenThread}. */
export interface OpenThreadConfig {
    conversation: ChatConversation;

    /** True for a thread with no history to load - a new one. */
    isLoaded: boolean;

    /** Called when the conversation's thread id changes, with the id it had before. */
    onThreadIdChange: (thread: OpenThread, prevThreadId: string) => void;

    /** Called when the conversation starts or ends a turn. */
    onBusyChange: (thread: OpenThread) => void;
}

/**
 * A thread with an open conversation in a `ChatThreadsModel`: the conversation, which this object
 * owns, the state of its history, and the reactions that report the conversation's changes back
 * to the threads model.
 * @internal
 */
export class OpenThread extends HoistBase {
    @managed readonly conversation: ChatConversation;

    /** State of the thread's history. (observable) */
    @observable accessor loadState: OpenThreadLoadState;

    /** Why the history failed to load, or null. (observable) */
    @observableRef accessor loadError: Error = null;

    /**
     * True if the thread may exist on the backend: one opened to load its history, or a new one
     * whose first turn reached the backend - see {@link ChatConversation.isSaved}. False for a
     * new thread until then, so that a route never holds an id the backend has not seen.
     * (observable)
     */
    @observable accessor isSaved: boolean;

    /** The conversation's `ChatModel`, or null for a conversation of the app's own. */
    get chatModel(): ChatModel {
        const {conversation} = this;
        return conversation instanceof ChatModelConversation ? conversation.chatModel : null;
    }

    constructor({conversation, isLoaded, onThreadIdChange, onBusyChange}: OpenThreadConfig) {
        super();
        this.conversation = conversation;
        this.loadState = isLoaded ? 'loaded' : 'loading';
        this.isSaved = !isLoaded;
        this.addReaction(
            {
                track: () => conversation.threadId,
                run: (_, prevThreadId) => onThreadIdChange(this, prevThreadId)
            },
            {
                track: () => conversation.isBusy,
                run: () => onBusyChange(this)
            }
        );

        // A chat adopts the backend's id before its reply moves to streaming, in the same flush,
        // so the thread is re-keyed before it counts as saved.
        // A conversation of the app's own reports it through `isSaved`, which this copies after
        // the reactions above, so that an id it adopts in the same action is re-keyed first.
        const {chatModel} = this;
        if (chatModel) {
            this.addReaction({
                track: () => chatModel.status === 'streaming',
                run: isStreaming => {
                    if (isStreaming) this.setSaved(true);
                }
            });
        } else {
            this.addReaction({
                track: () => conversation.isSaved,
                run: isSaved => {
                    if (isSaved) this.setSaved(true);
                },
                fireImmediately: true
            });
        }
    }

    @action
    setSaved(isSaved: boolean) {
        this.isSaved = isSaved;
    }

    /**
     * Start a load of the history, superseding any load in flight.
     * @returns a key that identifies the load - see {@link isLoadCurrent}.
     */
    @action
    beginLoad(): number {
        this.loadState = 'loading';
        this.loadError = null;
        return ++this.loadCount;
    }

    /** End the current load, failed if given an error. */
    @action
    endLoad(error: Error = null) {
        this.loadState = error ? 'failed' : 'loaded';
        this.loadError = error;
    }

    /** End the current load for a thread that the store reported missing. */
    @action
    endLoadNotFound() {
        this.loadState = 'notFound';
        this.loadError = null;
    }

    /**
     * Mark the history as loaded and drop any load in flight - for a conversation that now holds
     * another thread, after the app cleared it or loaded messages into it.
     */
    @action
    resetLoad() {
        this.loadCount++;
        this.endLoad();
    }

    /** True if the load with this key is the latest, and the thread is still open. */
    isLoadCurrent(loadKey: number): boolean {
        return !this.isDestroyed && this.loadCount === loadKey;
    }

    //------------------
    // Implementation
    //------------------
    private loadCount = 0;
}
