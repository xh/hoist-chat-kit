import {last} from 'lodash';
import type {ChatFilePart, ChatModel, ChatPart, ChatToolCallPart} from '../../../../core';
import {isAwaitingAnswer} from './ToolCallStatus';

/**
 * Consecutive files of a message, shown together as one row of chips.
 * @internal
 */
export interface ChatFileGroup {
    type: 'fileGroup';
    id: string;
    parts: ChatFilePart[];
}

/**
 * Consecutive tool calls of one step, shown together as one quiet row.
 * @internal
 */
export interface ChatToolCallGroupSpec {
    type: 'toolCallGroup';
    id: string;
    parts: ChatToolCallPart[];
}

/** @internal */
export type ChatPartGroup = ChatPart | ChatFileGroup | ChatToolCallGroupSpec;

/**
 * Group the parts of an assistant message for display, in order. Sources are left out, as they
 * show after the body.
 *
 *  - Consecutive files form one group.
 *  - Two or more consecutive tool calls of the same step, each shown as a card, form one group.
 *    A call that waits for the user - for approval or for an answer - and a call shown inline
 *    are never grouped, so that they stay in view.
 *
 * @internal
 */
export function groupParts(parts: ChatPart[], chatModel: ChatModel): ChatPartGroup[] {
    const ret: ChatPartGroup[] = [];
    parts.forEach(part => {
        if (part.type === 'source') return;

        const prev = last(ret);
        if (part.type === 'file') {
            if (prev?.type === 'fileGroup') {
                prev.parts.push(part);
            } else {
                ret.push({type: 'fileGroup', id: `files-${part.id}`, parts: [part]});
            }
            return;
        }

        if (part.type === 'toolCall' && isGroupable(part, chatModel)) {
            if (prev?.type === 'toolCallGroup' && prev.parts[0].step === part.step) {
                prev.parts.push(part);
                return;
            }
            if (
                prev?.type === 'toolCall' &&
                prev.step === part.step &&
                isGroupable(prev, chatModel)
            ) {
                ret[ret.length - 1] = {
                    type: 'toolCallGroup',
                    id: `tools-${prev.id}`,
                    parts: [prev, part]
                };
                return;
            }
        }

        ret.push(part);
    });
    return ret;
}

//------------------
// Implementation
//------------------
function isGroupable(call: ChatToolCallPart, chatModel: ChatModel): boolean {
    const spec = chatModel.getToolSpec(call.toolName);
    return (
        spec?.display !== 'inline' &&
        call.state !== 'approval-requested' &&
        !isAwaitingAnswer(call, spec)
    );
}
