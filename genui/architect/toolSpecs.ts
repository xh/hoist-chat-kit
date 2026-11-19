/**
 * The names, descriptions and input schemas of the Architect's chat tools, with no imports, so
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
