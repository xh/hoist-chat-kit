/** A user's rating of an assistant message. */
export type ChatFeedbackRating = 'positive' | 'negative';

/** Configuration for message feedback - see {@link ChatModelConfig.feedback}. */
export interface ChatFeedbackConfig {
    /**
     * Sends feedback to the backend. Default the thread layer's submitter - see
     * {@link ChatModel.setFeedbackSubmitter} - so a chat in a `ChatThreadsModel` uses its
     * store's `submitFeedbackAsync`. Without either, the chat takes no feedback.
     */
    submitAsync?: ChatFeedbackSubmitter;

    /**
     * Ratings for which the UI opens the comment form at once. Other ratings save at once and
     * offer "Add a comment" after, unless this is 'none'. Default 'negative'.
     */
    commentOn?: 'negative' | 'positive' | 'both' | 'none';

    /**
     * True if a rating in `commentOn` saves only with a comment. The rating then saves nothing
     * until the user sends a non-blank comment. Otherwise it saves at once, and the comment
     * follows as an update. Default false.
     */
    requireComment?: boolean;

    /**
     * Reasons the user may pick on a negative rating, as toggles above the comment, such as
     * `['Wrong data', 'Incomplete']`. Optional for the user, and never a substitute for a
     * required comment. Default none.
     */
    reasons?: string[];

    /**
     * True if a click on the chosen thumb clears the rating, by submitting a null rating. Set
     * false for a backend that cannot remove a rating. Default true.
     */
    clearable?: boolean;

    /**
     * Most characters the comment field takes. A counter shows from 90% of it. Default 1,000.
     */
    maxCommentLength?: number;
}

/** Sends feedback on a message to the backend. */
export type ChatFeedbackSubmitter = (spec: ChatFeedbackSpec) => Promise<void>;

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

    /** The reasons the user picked, from `ChatFeedbackConfig.reasons`, or null. */
    reasons?: string[];
}

/**
 * Feedback recorded on an assistant message, as `metadata.feedback`. A rating restored from
 * history usually comes back without its comment and reasons, which backends rarely return.
 */
export interface ChatFeedback {
    rating: ChatFeedbackRating;
    comment?: string;
    reasons?: string[];
}
