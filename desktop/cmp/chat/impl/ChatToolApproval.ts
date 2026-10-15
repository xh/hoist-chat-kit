import {isFunction} from 'lodash';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {bindable} from '@xh/hoist/mobx';
import {createObservableRef} from '@xh/hoist/utils/react';
import type {ChatMessageListHost, ChatToolCallPart, ChatToolSpec} from '../../../../core';
import {classNames} from '../../../../impl/ClassNames';
import '../ChatToolCall.scss';

/** @internal */
export interface ChatToolApprovalProps extends HoistProps {
    part: ChatToolCallPart;
    spec: ChatToolSpec;
    host: ChatMessageListHost;
}

/**
 * The decision a call waits for: the prompt and any preview, then Allow, Deny and an optional
 * reason sent with either. Allow comes first, left-aligned, as in a form. Neither is a default -
 * Enter in the reason sends nothing - and no shortcut ever allows.
 *
 * Focus moves to Allow only if focus was already in the conversation and the composer is empty,
 * so that a request never takes the keyboard from someone typing. Allow and Deny move focus to the
 * reply, as the panel goes once the call is decided.
 * @internal
 */
export const chatToolApproval = hoistCmp.factory<ChatToolApprovalProps>({
    displayName: 'ChatToolCallApproval',

    render({className, part, spec, host}) {
        const impl = useLocalModel(ApprovalLocalModel),
            {approvalPrompt, preview} = spec ?? {},
            input = part.input ?? {},
            prompt = isFunction(approvalPrompt)
                ? approvalPrompt(input)
                : (approvalPrompt ?? 'Allow this action to run?'),
            previewContent = isFunction(preview) ? preview(input) : null,
            reasonOf = () => impl.reason.trim() || undefined;
        impl.host = host;

        return div({
            className: classNames('xh-chat-tool-call__approval', className),
            role: 'group',
            'aria-label': 'Approval needed',
            items: [
                div({
                    className: 'xh-chat-tool-call__approval-text',
                    items: [
                        prompt,
                        previewContent != null
                            ? div({className: 'xh-chat-tool-call__preview', item: previewContent})
                            : null
                    ]
                }),
                div({
                    className: 'xh-chat-tool-call__approval-bar',
                    items: [
                        host?.approveToolCallAsync
                            ? button({
                                  ref: impl.allowRef,
                                  className: 'xh-chat-tool-call__allow',
                                  text: 'Allow',
                                  icon: Icon.check(),
                                  intent: 'primary',
                                  minimal: false,
                                  onClick: e => {
                                      focusReplyOf(e.currentTarget);
                                      host.approveToolCallAsync(part.id, reasonOf()).catchDefault();
                                  }
                              })
                            : null,
                        host?.denyToolCallAsync
                            ? button({
                                  className: 'xh-chat-tool-call__deny',
                                  text: 'Deny',
                                  outlined: true,
                                  minimal: false,
                                  onClick: e => {
                                      focusReplyOf(e.currentTarget);
                                      host.denyToolCallAsync(part.id, reasonOf()).catchDefault();
                                  }
                              })
                            : null,
                        host?.approveToolCallAsync || host?.denyToolCallAsync
                            ? textInput({
                                  className: 'xh-chat-tool-call__reason',
                                  model: impl,
                                  bind: 'reason',
                                  commitOnChange: true,
                                  width: null,
                                  placeholder: 'Reason (optional, sent to the agent)',
                                  domAttrs: {'aria-label': 'Reason, sent to the agent'}
                              })
                            : null
                    ]
                })
            ]
        });
    }
});

// Move focus from a button that is about to go to the reply that holds it - unless focus is
// somewhere else of the user's choosing.
function focusReplyOf(button: HTMLElement) {
    const reply = button.closest<HTMLElement>('.xh-chat-message'),
        active = document.activeElement;
    if (!reply || (active && active !== document.body && !button.contains(active))) return;
    reply.focus();
}

class ApprovalLocalModel extends HoistModel {
    override xhImpl = true;

    @bindable accessor reason: string = '';

    host: ChatMessageListHost = null;

    readonly allowRef = createObservableRef<HTMLElement>();

    override onLinked() {
        // Checked once, as the request arrives - never as it renders again.
        this.addReaction({
            track: () => this.allowRef.current,
            run: allow => {
                if (!allow || this.hasChecked) return;
                this.hasChecked = true;
                const log = allow.closest('[role="log"]'),
                    active = document.activeElement;
                if (!log || !active || !log.contains(active)) return;
                if (this.host?.composerModel?.text) return;
                allow.focus();
            },
            fireImmediately: true
        });
    }

    private hasChecked = false;
}
