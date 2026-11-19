import {div} from '@xh/hoist/cmp/layout';
import {isString, truncate} from 'lodash';
import type {ArchitectTarget} from '../../blueprint';
import type {ChatToolSpec} from '../../core';
import {REQUEST_DESIGN_MODE_SPEC} from './toolSpecs';

/** A target whose mode the Architect can ask to change. */
export type DesignModeTarget = Pick<ArchitectTarget, 'mode' | 'access'> &
    Required<Pick<ArchitectTarget, 'setMode'>>;

/**
 * The Architect's `request_design_mode` tool: asks the user, on the chat's approval card, to
 * switch the target to design mode, so the Architect can edit it. The card's question is the
 * kit's own, and the model's reason shows only as a quote beneath it. Only the model can call it,
 * never a UI action. It returns the mode that results.
 */
export function requestDesignModeTool(target: DesignModeTarget): ChatToolSpec {
    const canAsk = () => target.mode === 'run' && target.access === 'write';
    return {
        ...REQUEST_DESIGN_MODE_SPEC,
        displayName: 'Design mode',
        needsApproval: () => canAsk(),
        allowActions: false,
        approvalPrompt: input =>
            div({
                items: [
                    div('Let the Architect edit this blueprint? It switches to design mode.'),
                    isString(input?.reason) && input.reason
                        ? div({
                              className: 'xh-text-color-muted',
                              item: `"${truncate(input.reason, {length: 200})}"`
                          })
                        : null
                ]
            }),
        execute: () => {
            if (target.access !== 'write') {
                return {
                    mode: target.mode,
                    refused:
                        'The user has read access only. Offer the user a copy of the blueprint to edit.'
                };
            }
            target.setMode('design');
            return {mode: target.mode};
        }
    };
}
