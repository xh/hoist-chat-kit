import {
    FEATURE_REQUEST_CATEGORIES,
    MAX_FRAGMENT_LENGTH,
    MAX_SUMMARY_LENGTH,
    MAX_USER_WORDS_LENGTH,
    MAX_WORKAROUND_LENGTH
} from './featureRequestCheck';

/**
 * The names, descriptions and input schemas of the Architect's chat tools, with no Hoist imports, so
 * that the Node harness that tests the Architect offers the model the same tools.
 * @internal
 */
export const READ_ANSWER_SPEC = {
    name: 'read_answer',
    description:
        "Read an answer of this chat, to add it to the blueprint. With no answer, lists the answers of recent replies. With one, returns its blueprint, and for each artifact it reads, the dataset source that gives the artifact's rows, the widget config its query set, and the blueprint's sources that already give the same rows. A program with state returns its text.",
    parameters: {
        type: 'object',
        properties: {
            answer: {type: 'string', description: 'An answer ID from the list, as messageId:n.'}
        }
    }
};

/** @internal */
export const REQUEST_DESIGN_MODE_SPEC = {
    name: 'request_design_mode',
    description:
        'Ask the user to switch the blueprint to design mode, so that you can edit it. Call it before an edit in run mode. The user approves or declines on a card. Returns the mode that results: edit only if it is design.',
    parameters: {
        type: 'object',
        properties: {
            reason: {type: 'string', description: 'One sentence on what you will change.'}
        }
    }
};

/** @internal */
export const REQUEST_FEATURE_SPEC = {
    name: 'request_feature',
    description:
        "Send the app's team a request for a capability that no widget, renderer, variable type, resolver or action gives, after you have built the closest supported way. Call it at most once a turn, and only for something the user asked for. The user sees the whole request on a card and approves or declines it. Returns whether it was sent: never say it was sent unless it was.",
    parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'category', 'userWords'],
        properties: {
            summary: {
                type: 'string',
                maxLength: MAX_SUMMARY_LENGTH,
                description: 'What is missing, in one line.'
            },
            category: {
                type: 'string',
                enum: [...FEATURE_REQUEST_CATEGORIES]
            },
            userWords: {
                type: 'string',
                maxLength: MAX_USER_WORDS_LENGTH,
                description:
                    "The user's own words that ask for it, copied exactly from one of their messages."
            },
            workaround: {
                type: ['string', 'null'],
                maxLength: MAX_WORKAROUND_LENGTH,
                description: 'What you built instead, or null.'
            },
            fragment: {
                type: 'object',
                description: `Optional: the element or config the capability would change, at most ${MAX_FRAGMENT_LENGTH} characters of JSON. Never include inline rows or artifacts.`
            }
        }
    }
};
