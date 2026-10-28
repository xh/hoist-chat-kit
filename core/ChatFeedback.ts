import type {ChatMessage} from './ChatMessage';

/** A user's rating of an assistant message. */
export type ChatFeedbackRating = 'positive' | 'negative';

/** Configuration for message feedback - see {@link ChatModelConfig.feedback}. */
export interface ChatFeedbackConfig extends ChatFeedbackSettings {
    /**
     * Sends feedback to the backend. Default the thread layer's submitter - see
     * {@link ChatModel.setFeedbackSubmitter} - so a chat in a `ChatThreadsModel` uses its
     * store's `submitFeedbackAsync`. Without either, the chat takes no feedback.
     */
    submitAsync?: ChatFeedbackSubmitter;
}

/** How the feedback controls behave - part of {@link ChatFeedbackConfig}. */
export interface ChatFeedbackSettings {
    /**
     * True if the user can add a comment to a rating. A thumbs down then opens the comment form
     * at once. A thumbs up saves at once and offers "Add a comment" after. Default true.
     */
    allowComment?: boolean;

    /**
     * True if a thumbs down saves only with a comment. The rating then saves nothing until the
     * user sends a non-blank comment. Otherwise it saves at once, and the comment follows as an
     * update. Applies only with `allowComment`. Default false.
     */
    requireComment?: boolean;

    /**
     * True if a click on the chosen thumb clears the rating, by submitting a null rating. Set
     * false for a backend that cannot remove a rating. Default true.
     */
    clearable?: boolean;

    /**
     * True if the user can change a saved rating, to the other thumb or, with `clearable`, to
     * none. Set false for a backend that treats each rating as an event of its own, such as one
     * that sends a notification for each. The rating then locks once it saves, and a comment can
     * still follow it. Until a save succeeds, the user can still switch thumbs. Default true.
     */
    allowChange?: boolean;

    /**
     * Most characters the comment field takes, or null for no limit. A counter shows from 90% of
     * it. Default 1,000.
     */
    maxCommentLength?: number;
}

/**
 * Sends feedback on a message to the backend. The rated message comes with the spec, for a
 * backend that needs its text - post the spec, not the message, as the body.
 */
export type ChatFeedbackSubmitter = (spec: ChatFeedbackSpec, message: ChatMessage) => Promise<void>;

/** Feedback on one assistant message, as sent to the backend. */
export interface ChatFeedbackSpec {
    /** The conversation that holds the message. */
    threadId: string;

    /** The message's kit id. */
    messageId: string;

    /** The message's server id, from `metadata.serverId`, or null. */
    serverId: string;

    /** The run that wrote the message, from `metadata.runId`, or null. */
    runId: string;

    /** The rating, or null to clear one given before. */
    rating: ChatFeedbackRating;

    /** The user's comment, or null. */
    comment?: string;
}

/**
 * Feedback recorded on an assistant message, as `metadata.feedback`. A rating restored from
 * history usually comes back without its comment, which backends rarely return.
 */
export interface ChatFeedback {
    rating: ChatFeedbackRating;
    comment?: string;
}

/**
 * A comment typed in a feedback form and not yet sent - see {@link ChatModel.feedbackDrafts}.
 */
export interface ChatFeedbackDraft {
    /** The rating the comment goes with. */
    rating: ChatFeedbackRating;

    /** The comment so far. */
    comment: string;

    /** True if the rating saves only with the comment, so nothing is saved yet. */
    isPending: boolean;

    /** True while the comment sends. */
    isSending: boolean;

    /** Why the last send of the comment failed, or null. */
    error: Error;
}

/**
 * What the feedback controls need of a conversation to rate its replies - see the desktop
 * `ChatFeedbackControls`. Implement it to take feedback in a conversation that is not a
 * `ChatModel`. A `ChatModel` needs none: pass it as the controls' host.
 *
 * The controls read these members in render, so make them observable for the controls to update.
 */
export interface ChatFeedbackHost {
    /** The conversation's id, sent as the `threadId` of each {@link ChatFeedbackSpec}. */
    readonly threadId: string;

    /** The feedback saved on a message, or null. */
    getFeedback(message: ChatMessage): ChatFeedback;

    /**
     * Save feedback on a message, or clear its rating with a null `rating`. The rated message
     * comes with the spec, for a backend that needs its text. Resolve once saved,
     * with `getFeedback` then returning it. Reject if the save fails. A rejection with an
     * `httpStatus` of 400, 413 or 422 counts as refused: the form shows its message, with no Retry.
     *
     * The controls show the new rating while this runs, and the saved one again if it fails.
     */
    submitFeedbackAsync(spec: ChatFeedbackSpec, message: ChatMessage): Promise<void>;

    /** How the controls behave. Default all the defaults of {@link ChatFeedbackSettings}. */
    readonly feedbackSettings?: ChatFeedbackSettings;

    /**
     * Comments typed and not yet sent, by message id, so that a form keeps its comment when its
     * controls mount again. Give `setFeedbackDraft` with it, and remove the drafts of messages
     * that go. Without both, the kit keeps a draft while its controls are mounted.
     */
    readonly feedbackDrafts?: Record<string, ChatFeedbackDraft>;

    /** Keep a message's draft, or remove it with null - see `feedbackDrafts`. */
    setFeedbackDraft?(messageId: string, draft: ChatFeedbackDraft): void;

    /**
     * The conversation's messages, so that "Add a comment" hides once the user sends again.
     * Without them, it shows until the next rating.
     */
    readonly messages?: ChatMessage[];
}
