import {
    chatAnnouncer,
    ChatKit,
    type ChatModel,
    type ChatToolCallPart,
    isToolCallFailed,
    isToolCallFinal
} from '../../../../core';
import {formatStepDuration} from './ChatTimelineItems';
import {getErrorLine, getToolTitle} from './ToolCallStatus';

/** Which steps the announcer reads as they finish - see `ChatKit.defaults.announceSteps`. */
export type ChatAnnounceSteps = 'none' | 'failures' | 'all';

/**
 * Announces the steps of a reply as they finish while it runs, as `announceSteps` asks: failures,
 * or every step. Steps already done when it first sees them - such as in history - are never
 * announced, and neither are calls cancelled by a stop. One per timeline block, and one for the
 * calls a message shows as cards.
 * @internal
 */
export class ChatStepAnnouncer {
    /**
     * Note the calls as they stand now, announcing those that finished since the last note.
     *
     * @param stepOffset - steps that come before these in the reply, for the step number.
     */
    note(
        calls: ChatToolCallPart[],
        {
            isLive,
            chatModel,
            announceSteps,
            stepOffset = 0
        }: {
            isLive: boolean;
            chatModel: ChatModel;
            announceSteps?: ChatAnnounceSteps;
            stepOffset?: number;
        }
    ) {
        announceSteps ??= ChatKit.defaults.announceSteps;
        if (!this.knownFinal) {
            this.knownFinal = new Set(calls.filter(isToolCallFinal).map(it => it.id));
            return;
        }
        calls.forEach((call, idx) => {
            if (!isToolCallFinal(call) || this.knownFinal.has(call.id)) return;
            this.knownFinal.add(call.id);
            if (!isLive || announceSteps === 'none' || call.cancelled) return;

            const title = getToolTitle(call, chatModel?.getToolSpec(call.toolName));
            if (isToolCallFailed(call)) {
                const cause = getErrorLine(call);
                chatAnnouncer.announce(`Step failed: ${title}${cause ? `, ${cause}` : ''}.`);
            } else if (announceSteps === 'all' && call.state === 'output-available') {
                const took =
                    call.startedAt != null && call.endedAt != null
                        ? formatStepDuration(call.endedAt - call.startedAt)
                        : null;
                chatAnnouncer.announce(
                    `Step ${stepOffset + idx + 1} done: ${title}${took ? `, ${took}` : ''}.`
                );
            }
        });
    }

    //------------------
    // Implementation
    //------------------
    private knownFinal: Set<string> = null;
}
