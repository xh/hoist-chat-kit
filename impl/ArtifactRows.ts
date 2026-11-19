import type {PlainObject} from '@xh/hoist/core';

/**
 * The rows of the artifacts a chat made in this session, by chat. A chat keeps its artifacts with
 * their replies without rows, so that a thread stays small. An answer shows these, the rows the
 * model saw, for as long as the chat lives. After a reload they are gone.
 * @internal
 */
export function keepArtifactRows(chat: object, id: string, rows: PlainObject[]) {
    let kept = byChat.get(chat);
    if (!kept) byChat.set(chat, (kept = new Map()));
    kept.set(id, rows);
}

/** The rows of an artifact that this session's chat kept, or null. @internal */
export function getArtifactRows(chat: object, id: string): PlainObject[] {
    return (chat && byChat.get(chat)?.get(id)) ?? null;
}

//------------------
// Implementation
//------------------
const byChat = new WeakMap<object, Map<string, PlainObject[]>>();
