import type {ChatMessage} from '../ChatMessage';
import {
    type ChatPart,
    type ChatTextPart,
    type ChatToolCallPart,
    isToolCallFinal
} from '../ChatPart';
import {genChatId} from './ids';

/**
 * A finished text part, with a new id.
 * @internal
 */
export function createTextPart(text: string): ChatTextPart {
    return {type: 'text', id: genChatId(), text, state: 'done'};
}

/**
 * A copy of a message with one part changed.
 * @internal
 */
export function updatePart<T extends ChatPart>(
    message: ChatMessage,
    partId: string,
    changes: Partial<T>
): ChatMessage {
    const parts = message.parts.map(it => (it.id === partId ? ({...it, ...changes} as T) : it));
    return message.withChanges({parts});
}

/**
 * A copy of a message with its streaming text and reasoning parts marked done. Tool calls are
 * left as they are. Returns the same message if nothing was streaming.
 * @internal
 */
export function settleStreamingParts(message: ChatMessage): ChatMessage {
    return settleParts(message, null);
}

/**
 * A copy of a message with nothing left in progress, for a turn that ends early. Streaming text
 * and reasoning parts are marked done. Unfinished tool calls are closed with `reason` - as denied
 * if they awaited approval, else as failed - so that every call in the history has a result.
 * Returns the same message if nothing was open.
 * @internal
 */
export function settleOpenParts(message: ChatMessage, reason: string): ChatMessage {
    return settleParts(message, reason);
}

/**
 * Tool calls from one step of an assistant message that the client must resolve - those not run
 * by the backend.
 * @internal
 */
export function getClientToolCalls(message: ChatMessage, step: number): ChatToolCallPart[] {
    return message.toolCalls.filter(it => it.step === step && !it.providerExecuted);
}

//------------------
// Implementation
//------------------
/** Settle streaming parts, and tool calls too if given a reason to close them with. */
function settleParts(message: ChatMessage, toolCallReason: string): ChatMessage {
    let changed = false;
    const now = Date.now(),
        parts = message.parts.map((part): ChatPart => {
            switch (part.type) {
                case 'text':
                    if (part.state !== 'streaming') return part;
                    changed = true;
                    return {...part, state: 'done'};
                case 'reasoning':
                    if (part.state !== 'streaming') return part;
                    changed = true;
                    return {...part, state: 'done', endedAt: now};
                case 'toolCall':
                    if (toolCallReason == null || isToolCallFinal(part)) return part;
                    changed = true;
                    return {
                        ...part,
                        state:
                            part.state === 'approval-requested' ? 'output-denied' : 'output-error',
                        errorText: toolCallReason
                    };
                default:
                    return part;
            }
        });
    return changed ? message.withChanges({parts}) : message;
}
