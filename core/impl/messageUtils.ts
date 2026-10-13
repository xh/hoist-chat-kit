import type {ChatMessage} from '../ChatMessage';
import {type ChatPart, type ChatToolCallPart, isToolCallFinal} from '../ChatPart';

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
 * A copy of a message with nothing left in progress, for a turn that ends early. Streaming text
 * and reasoning parts are marked done. Unfinished tool calls are closed with `reason` - as denied
 * if they awaited approval, else as failed - so that every call in the history has a result.
 * @internal
 */
export function settleOpenParts(message: ChatMessage, reason: string): ChatMessage {
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
                    if (isToolCallFinal(part)) return part;
                    changed = true;
                    return {
                        ...part,
                        state:
                            part.state === 'approval-requested' ? 'output-denied' : 'output-error',
                        errorText: reason
                    };
                default:
                    return part;
            }
        });
    return changed ? message.withChanges({parts}) : message;
}

/**
 * Tool calls from one step of an assistant message that the client must resolve - those not run
 * by the backend.
 * @internal
 */
export function getClientToolCalls(message: ChatMessage, step: number): ChatToolCallPart[] {
    return message.toolCalls.filter(it => it.step === step && !it.providerExecuted);
}
