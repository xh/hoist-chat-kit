import {
    type ChatDataPart,
    type ChatPart,
    type ChatReasoningPart,
    type ChatTextPart,
    type ChatToolCallPart,
    isChatSubagentPart,
    isToolCallFinal
} from '../../core';

/** One AG-UI message that a step of a reply makes, with the parts it holds. @internal */
export type AgUiMessageGroup =
    | {role: 'reasoning'; id: string; part: ChatReasoningPart}
    | AgUiAssistantGroup
    | {role: 'tool'; id: string; call: ChatToolCallPart}
    | {role: 'activity'; id: string; part: ChatDataPart};

/** An AG-UI assistant message: its text and the calls it made. @internal */
export interface AgUiAssistantGroup {
    role: 'assistant';
    id: string;
    texts: ChatTextPart[];
    calls: ChatToolCallPart[];
}

/**
 * The AG-UI messages that the parts of one step of a reply make, in order, with the ids the
 * server gave them. This follows the official client's assembly, so that a backend that merges
 * its history by id finds its own messages:
 *
 *  - a reasoning part is a `reasoning` message, with its `serverId`.
 *  - text joins the `assistant` message of its `serverId`.
 *  - a tool call joins the `assistant` message its `parentServerId` names. A call with none joins
 *    the step's last `assistant` message.
 *  - each finished call's result is a `tool` message, with its `resultServerId`, right after the
 *    `assistant` message that made the call. A server call an interrupted run left open has none
 *    until the server sends its result.
 *  - a data part is an `activity` message. Sub-agent parts, which AG-UI holds outside its
 *    messages, are left out.
 *
 * An id goes out once per request. A part with no server id, or with one already taken, falls
 * back to `defaultId` for text and calls, to the part's own id for reasoning, and to the call's id
 * plus `-result` for a result. A fallback already taken gets a numbered suffix.
 *
 * @param usedIds - ids that earlier messages and steps of the request took. Updated with each id
 *      this step takes, as it takes it.
 * @internal
 */
export function groupAgUiMessages(
    parts: ChatPart[],
    defaultId: string,
    usedIds: Set<string> = new Set()
): AgUiMessageGroup[] {
    const groups: AgUiMessageGroup[] = [],
        assistants = new Map<string, AgUiAssistantGroup>(),
        takeId = (serverId: string, fallback: string) => takeAgUiId(usedIds, serverId, fallback);
    let lastAssistant: AgUiAssistantGroup = null;

    // Parts that name the same message join one group, keyed by the id they name.
    const getAssistant = (key: string): AgUiAssistantGroup => {
        let ret = assistants.get(key);
        if (!ret) {
            ret = {role: 'assistant', id: takeId(key, defaultId), texts: [], calls: []};
            assistants.set(key, ret);
            groups.push(ret);
        }
        return (lastAssistant = ret);
    };

    parts.forEach(part => {
        switch (part.type) {
            case 'reasoning':
                groups.push({role: 'reasoning', id: takeId(part.serverId, part.id), part});
                break;
            case 'text':
                getAssistant(part.serverId ?? defaultId).texts.push(part);
                break;
            case 'toolCall': {
                const group =
                    part.parentServerId != null
                        ? getAssistant(part.parentServerId)
                        : (lastAssistant ?? getAssistant(defaultId));
                group.calls.push(part);
                break;
            }
            case 'data':
                if (!isChatSubagentPart(part)) {
                    const data = part as ChatDataPart;
                    groups.push({role: 'activity', id: takeId(data.id, data.id), part: data});
                }
                break;
        }
    });

    return groups.flatMap((group): AgUiMessageGroup[] =>
        group.role === 'assistant'
            ? [
                  group,
                  ...group.calls.filter(hasResult).map(call => ({
                      role: 'tool' as const,
                      id: takeId(call.resultServerId, `${call.id}-result`),
                      call
                  }))
              ]
            : [group]
    );
}

/**
 * True if a call's result goes back as a tool message. A server call an interrupted run left open
 * has none until the server sends it, whatever the chat shows for it.
 */
function hasResult(call: ChatToolCallPart): boolean {
    return isToolCallFinal(call) && !(call.awaitsResume && call.resultServerId == null);
}

/**
 * Take an id for an AG-UI message, once per request: the server's id if it is free, else the
 * fallback, else the fallback with a numbered suffix.
 * @internal
 */
export function takeAgUiId(usedIds: Set<string>, serverId: string, fallback: string): string {
    let ret = serverId != null && !usedIds.has(serverId) ? serverId : fallback;
    for (let n = 2; usedIds.has(ret); n++) ret = `${fallback}-${n}`;
    usedIds.add(ret);
    return ret;
}

/**
 * The server ids that a message's parts keep, which the message itself must not take.
 * @internal
 */
export function getPartServerIds(parts: ChatPart[]): Set<string> {
    const ret = new Set<string>();
    parts.forEach(part => {
        if (part.type === 'text' || part.type === 'reasoning') {
            if (part.serverId != null) ret.add(part.serverId);
        } else if (part.type === 'toolCall') {
            if (part.parentServerId != null) ret.add(part.parentServerId);
            if (part.resultServerId != null) ret.add(part.resultServerId);
        }
    });
    return ret;
}

/**
 * The text of an assistant message. Parts with the same server id are one AG-UI message that
 * reopened, so they join with nothing between them. Other parts are separate blocks of text.
 * @internal
 */
export function getAgUiAssistantText({texts}: AgUiAssistantGroup): string {
    return texts
        .map((part, idx) => {
            const prev = texts[idx - 1];
            if (!prev) return part.text;
            return part.serverId != null && part.serverId === prev.serverId
                ? part.text
                : `\n\n${part.text}`;
        })
        .join('');
}
