/**
 * Prefix of every key the kit writes to `XH.localStorageService`, which namespaces keys by app
 * and user. `ChatKit.clearLocalData()` removes the keys with this prefix.
 * @internal
 */
export const CHAT_STORAGE_PREFIX = 'xhChat.';

/** The local storage key of a thread's composer draft. @internal */
export function chatDraftKey(threadId: string): string {
    return `${CHAT_STORAGE_PREFIX}draft.${threadId}`;
}
