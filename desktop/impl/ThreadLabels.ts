import {upperFirst} from 'lodash';

/**
 * The word for a thread in the kit's own text, in the forms that text needs - see
 * `ChatThreadListProps.threadNoun`.
 * @internal
 */
export interface ThreadLabels {
    /** The word, such as 'thread'. */
    singular: string;

    /** Its plural, such as 'threads'. */
    plural: string;

    /** The word capitalized, such as 'Thread'. */
    title: string;

    /** The plural capitalized, such as 'Threads'. */
    titlePlural: string;
}

/**
 * The forms of a word for a thread. Default 'thread'. The plural adds an s, and the title form
 * raises the first letter, so a noun such as 'query' or 'AI chat' needs no further change.
 * @internal
 */
export function getThreadLabels(noun: string = null): ThreadLabels {
    const singular = noun?.trim() || 'thread',
        plural = `${singular}s`;
    return {singular, plural, title: upperFirst(singular), titlePlural: upperFirst(plural)};
}
