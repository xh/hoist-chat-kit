import {
    chatAnnouncer,
    type ChatTranscript,
    type ChatToolCallPart,
    isToolCallFailed,
    isToolCallFinal
} from '../../../../core';
import {getHostToolSpec} from './groupParts';
import {getErrorLine, getToolTitle} from './ToolCallStatus';

/**
 * Announces the steps of a reply that fail while it runs. Steps already done when it first sees
 * them - such as in history - are never announced, and neither are calls cancelled by a stop.
 * One per timeline block, and one for the calls a message shows as cards.
 * @internal
 */
export class ChatStepAnnouncer {
    /** Note the calls as they stand now, announcing those that failed since the last note. */
    note(calls: ChatToolCallPart[], {isLive, host}: {isLive: boolean; host: ChatTranscript}) {
        if (!this.knownFinal) {
            this.knownFinal = new Set(calls.filter(isToolCallFinal).map(it => it.id));
            return;
        }
        calls.forEach(call => {
            if (!isToolCallFinal(call) || this.knownFinal.has(call.id)) return;
            this.knownFinal.add(call.id);
            if (!isLive || call.cancelled || !isToolCallFailed(call)) return;

            const title = getToolTitle(call, getHostToolSpec(host, call.toolName)),
                cause = getErrorLine(call);
            chatAnnouncer.announce(`Step failed: ${title}${cause ? `, ${cause}` : ''}.`);
        });
    }

    //------------------
    // Implementation
    //------------------
    private knownFinal: Set<string> = null;
}
