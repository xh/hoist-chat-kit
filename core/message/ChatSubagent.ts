import type {ChatDataPart, ChatPart} from './ChatPart';

/**
 * The `dataType` of a sub-agent's data part. The stream reducer adds one for each AG-UI
 * `SUBAGENT_STARTED` event, with the event's `subagentRunId` as the part's id, and ends it on
 * `SUBAGENT_FINISHED` or `SUBAGENT_ERROR`. Its `data` is a {@link ChatSubagentData}.
 *
 * The activity timeline nests the tool calls whose `subagentRunId` names the part under a row for
 * the sub-agent. Outside a timeline the part renders nothing.
 */
export const CHAT_SUBAGENT_DATA_TYPE = 'xh.chat.subagent';

/** The `data` of a {@link CHAT_SUBAGENT_DATA_TYPE} part. */
export interface ChatSubagentData {
    /** The sub-agent's name, for display. */
    name: string;

    /** What the sub-agent was asked to do, for display. */
    description?: string;

    /** The sub-agent that started this one, when sub-agents nest. */
    parentSubagentRunId?: string;

    /** The tool call that started this sub-agent, if any. */
    parentToolCallId?: string;

    /**
     * `running` until the sub-agent finishes, then `complete` or `error` - or `cancelled` if the
     * user stopped the turn first. A sub-agent still running when its run ends, with no end event,
     * ends with the run. `waiting` while it waits on the user's answer to an interrupt - a later
     * run continues it. A reply that closes before then ends it as `error`.
     */
    status: 'running' | 'waiting' | 'complete' | 'error' | 'cancelled';

    /** What the sub-agent found or did, once complete. */
    result?: any;

    /** Why the sub-agent failed, once in error. */
    error?: string;

    /** Epoch millis when the sub-agent started. */
    startedAt?: number;

    /** Epoch millis when the sub-agent ended, or null while it runs. */
    endedAt?: number;
}

/** True if a part is a sub-agent's data part - see {@link CHAT_SUBAGENT_DATA_TYPE}. */
export function isChatSubagentPart(part: ChatPart): part is ChatDataPart {
    return part.type === 'data' && part.dataType === CHAT_SUBAGENT_DATA_TYPE;
}
