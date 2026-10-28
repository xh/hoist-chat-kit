import type {ReactElement} from 'react';
import type {ChatDataPart} from './ChatPart';

/**
 * Declares how the data parts of one `dataType` display - for an agent's activity that is not a
 * tool call, such as a skill it loads. A backend sends one as an AG-UI `ACTIVITY_SNAPSHOT`, whose
 * `activityType` becomes the part's `dataType`, or as an `xh.chat.data` event.
 *
 * With `display: 'timeline'`, each part shows as a row in the reply's activity timeline, as a peer
 * of the tool calls there, and nests under the sub-agent named by its `subagentRunId`. The row
 * opens to the data renderer registered for the type, else to the part's data as JSON.
 *
 * ```ts
 * const skillActivity: ChatActivitySpec = {
 *     dataType: 'skill',
 *     display: 'timeline',
 *     displayName: 'Loaded skill',
 *     icon: Icon.book(),
 *     summary: part => part.data.skillName,
 *     noun: 'skill'
 * };
 * ```
 */
export interface ChatActivitySpec {
    /** The `dataType` of the parts this spec covers - an AG-UI activity's `activityType`. */
    dataType: string;

    /** How the parts display - see {@link ChatActivityDisplay}. Default `inline`. */
    display?: ChatActivityDisplay;

    /** Title for the part's timeline row. Defaults to the `dataType`, humanized. */
    displayName?: string;

    /**
     * Icon for the part's timeline row - one for every part of the type, or a function that
     * returns one for each part, such as an icon for the skill it names. A function that returns
     * null gets the default icon.
     */
    icon?: ReactElement | ((part: ChatDataPart) => ReactElement);

    /** One-line summary of a part, shown next to its title - e.g. the name of the skill. */
    summary?: (part: ChatDataPart) => string;

    /**
     * What one part counts as in the timeline's done line and the reply's announcement, in the
     * singular - e.g. `skill` for "Used 5 tools and 2 skills". Default none: the parts show as
     * rows but count in no summary.
     */
    noun?: string;
}

/**
 * How the data parts of a type display - see {@link ChatActivitySpec.display}.
 *
 *  - `inline` - the output of the type's data renderer, as part of the reply, else the data as
 *    JSON. As every data part displays with no spec.
 *  - `timeline` - a row in the reply's activity timeline, among its tool calls.
 *  - `hidden` - nothing. Hidden parts count in no summary.
 */
export type ChatActivityDisplay = 'inline' | 'timeline' | 'hidden';
