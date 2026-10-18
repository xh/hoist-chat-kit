import {HoistBase, managed} from '@xh/hoist/core';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import type {ChatModel} from '../../core';

/** State of an open thread's history. */
export type OpenThreadLoadState = 'loading' | 'loaded' | 'failed';

/** Configuration for an {@link OpenThread}. */
export interface OpenThreadConfig {
    chatModel: ChatModel;

    /** True for a thread with no history to load - a new one. */
    isLoaded: boolean;

    /** Called when the chat's thread id changes, with the id it had before. */
    onThreadIdChange: (thread: OpenThread, prevThreadId: string) => void;

    /** Called when the chat starts or ends a turn. */
    onBusyChange: (thread: OpenThread) => void;
}

/**
 * A thread with an open chat in a `ChatThreadsModel`: the chat, which this object owns, the state
 * of its history, and the reactions that report the chat's changes back to the threads model.
 * @internal
 */
export class OpenThread extends HoistBase {
    @managed readonly chatModel: ChatModel;

    /** State of the thread's history. (observable) */
    @observable accessor loadState: OpenThreadLoadState;

    /** Why the history failed to load, or null. (observable) */
    @observableRef accessor loadError: Error = null;

    constructor({chatModel, isLoaded, onThreadIdChange, onBusyChange}: OpenThreadConfig) {
        super();
        this.chatModel = chatModel;
        this.loadState = isLoaded ? 'loaded' : 'loading';
        this.addReaction(
            {
                track: () => chatModel.threadId,
                run: (_, prevThreadId) => onThreadIdChange(this, prevThreadId)
            },
            {
                track: () => chatModel.isBusy,
                run: () => onBusyChange(this)
            }
        );
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

    /**
     * Mark the history as loaded and drop any load in flight - for a chat that now holds another
     * thread, after the app cleared it or loaded messages into it.
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
