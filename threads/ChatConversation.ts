import type {PlainObject} from '@xh/hoist/core';
import type {ChatThreadEndedEarly} from './ChatThreadsModel';

/**
 * The conversation of one open thread, as a {@link ChatThreadsModel} sees it. The threads model
 * opens one for the selected thread, and keeps it open while a turn runs or waits for the user.
 *
 * The kit's own conversation is a `ChatModel`, which an app supplies through
 * `ChatThreadsConfig.createChatModel`. An app whose conversation runs on another library
 * implements this contract instead, through `ChatThreadsConfig.createConversation`, and keeps the
 * kit's thread list and its model. Each conversation is then a small adapter to the other
 * library's state for one thread.
 *
 * Mark the members that change as MobX observables, or compute them from observables, so that
 * the threads model sees each change.
 */
export interface ChatConversation {
    /**
     * Id of the thread. (observable)
     *
     * It may change once while a turn runs, to adopt an id the backend minted for a new thread.
     * The threads model then re-keys the thread. A change while no turn runs means the
     * conversation now holds another thread, and the old one stays in the list.
     */
    readonly threadId: string;

    /**
     * True while a turn runs. (observable)
     *
     * When it turns false on a thread the user is not reading, the threads model destroys the
     * conversation in the same reaction. Finish the turn's own work, such as saving its messages,
     * before it turns false.
     */
    readonly isBusy: boolean;

    /**
     * True while a turn waits for the user, such as to approve a tool call. The threads model
     * keeps the conversation open until the user answers. Default false. (observable)
     */
    readonly isAwaitingUser?: boolean;

    /**
     * True once the backend has the thread - for a new thread, once its first turn reached the
     * backend. The threads model then puts the thread in the route. Once true, a thread stays
     * saved until its id changes while idle. Leave it out, or null, to count a new thread saved
     * when its first turn ends. A thread opened to load its history counts as saved from the
     * start. (observable)
     *
     * A conversation that adopts the backend's id must change `threadId` before, or in the same
     * action as, it turns this true. Otherwise the route holds the browser's id for a moment.
     */
    readonly isSaved?: boolean;

    /**
     * How the last turn ended, if not with a reply to see, else null. A thread list marks a
     * thread whose turn `failed` or was `interrupted` in the background. A turn the user's own
     * action stopped, such as a switch to another thread in a library that cancels the reply, is
     * `cancelled`, and gets no mark. Without this, a turn that ends in the background counts as
     * a new reply. Default null. (observable)
     */
    readonly endedEarly?: ChatConversationEndedEarly;

    /**
     * Title for a new thread until the store lists it, such as the start of its first question.
     * Default 'New conversation'.
     */
    readonly title?: string;

    /**
     * Load the thread's history and show it. Called when an existing thread opens, and again for
     * {@link ChatThreadsModel.reloadThreadAsync}. A later call supersedes an earlier one that has
     * not ended, so apply only the latest result.
     *
     * Reject with an error that has `httpStatus` 404 for a thread that does not exist. Any other
     * error fails the load, which the threads model reports in `loadError`.
     */
    loadAsync(): Promise<void>;

    /** Stop the running turn, if any - as when the user deletes the thread. */
    stop(): void;

    /** Release the conversation's resources. Called when its thread closes. */
    destroy(): void;
}

/**
 * How a conversation's last turn ended, if not with a reply to see - see
 * {@link ChatConversation.endedEarly}. A thread list marks a `failed` or `interrupted` turn, as
 * {@link ChatThreadEndedEarly}. A `cancelled` turn gets no mark.
 */
export type ChatConversationEndedEarly =
    | ChatThreadEndedEarly
    | {
          /** The user's own action stopped the turn, such as a switch to another thread. */
          runEnd: 'cancelled';
          reason?: string;
      };

/** Passed to `ChatThreadsConfig.createChatModel` and `ChatThreadsConfig.createConversation`. */
export interface ChatConversationSpec {
    /** Id of the thread. The chat or conversation must take it as its `threadId`. */
    threadId: string;

    /** True for a new thread, false for one whose history the threads model is about to load. */
    isNew: boolean;

    /**
     * How to start a new thread, from {@link ChatThreadsModel.newThread}, or null. The threads
     * model applies it to a `ChatModel` itself. A conversation of an app's own applies what it
     * can.
     */
    seed?: ChatSeedSpec;
}

/** How to start a new thread - see {@link ChatThreadsModel.newThread}. */
export interface ChatSeedSpec {
    /** Draft text to put in the composer. */
    draft?: string;

    /** Run options for the new chat, in place of those `createChatModel` gives it. */
    runOptions?: PlainObject;
}
