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

    /** Ratings for which the UI asks for a comment. Default 'negative'. */
    commentOn?: 'negative' | 'positive' | 'both' | 'none';

    /** True if a rating that asks for a comment requires one. Default false. */
    requireComment?: boolean;
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

    /** The user's comment, if any. */
    comment?: string;
}

/** Feedback recorded on an assistant message, as `metadata.feedback`. */
export interface ChatFeedback {
    rating: ChatFeedbackRating;
    comment?: string;
}
