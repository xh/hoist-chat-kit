import {isEmpty} from 'lodash';
import type {ReactElement, ReactNode} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import type {ChatMessage, ChatModel, ChatToolCallPart, ChatToolCallState} from '../../../core';
import '../../../styles/vars.scss';
import './ChatToolCall.scss';
import {humanizeToolName} from './impl/ChatFormat';
import {jsonView} from './impl/JsonView';

export interface ChatToolCallProps extends HoistProps {
    /** The tool call to show. */
    part: ChatToolCallPart;

    /** The message holding the call - passed to the tool's custom renderer. */
    message: ChatMessage;

    /** The conversation - for tool display config, and to approve or deny the call. */
    chatModel: ChatModel;
}

/**
 * A tool call by the model, as a collapsible card. The header shows the tool's icon, title, a
 * one-line summary and the call's status. The body shows the call's input and output as JSON, or
 * the tool's own rendering. A call waiting for approval shows Approve and Deny buttons.
 *
 * Display is configured per tool by its {@link ChatToolSpec}: `displayName`, `icon`, `summary`
 * and `renderer`.
 */
export const [ChatToolCall, chatToolCall] = hoistCmp.withFactory<ChatToolCallProps>({
    displayName: 'ChatToolCall',
    model: false,
    className: 'xh-chat-tool-call',

    render({className, part, message, chatModel}) {
        const impl = useLocalModel(ChatToolCallLocalModel),
            {toolName, state} = part,
            spec = chatModel.getToolSpec(toolName),
            isApproval = state === 'approval-requested',
            isExpanded = impl.expanded ?? (isApproval || !!spec?.renderer),
            summary = spec?.summary?.(part);

        return div({
            className: `${className} xh-chat-tool-call--${state}`,
            items: [
                button({
                    className: 'xh-chat-tool-call__header',
                    icon: spec?.icon ?? Icon.wrench(),
                    text: span({
                        className: 'xh-chat-tool-call__heading',
                        items: [
                            span({
                                className: 'xh-chat-tool-call__title',
                                item: spec?.displayName ?? humanizeToolName(toolName)
                            }),
                            summary
                                ? span({className: 'xh-chat-tool-call__summary', item: summary})
                                : null
                        ]
                    }),
                    rightIcon: span({
                        className: 'xh-chat-tool-call__status',
                        items: [
                            statusIndicator(state),
                            isExpanded ? Icon.chevronUp() : Icon.chevronDown()
                        ]
                    }),
                    'aria-expanded': isExpanded,
                    onClick: () => impl.setExpanded(!isExpanded)
                }),
                isApproval ? approvalBar(part, chatModel) : null,
                isExpanded
                    ? div({
                          className: 'xh-chat-tool-call__body',
                          item: spec?.renderer
                              ? spec.renderer(part, {chatModel, message})
                              : defaultBody(part)
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
class ChatToolCallLocalModel extends HoistModel {
    override xhImpl = true;

    /** Set once the user opens or closes the card - until then it follows the call's state. */
    @observable accessor expanded: boolean = null;

    @action
    setExpanded(expanded: boolean) {
        this.expanded = expanded;
    }
}

const STATUS_LABELS: Partial<Record<ChatToolCallState, string>> = {
    'input-streaming': 'Preparing',
    'input-available': 'Pending',
    'approval-requested': 'Needs approval',
    running: 'Running',
    'output-error': 'Failed',
    'output-denied': 'Denied'
};

function statusIndicator(state: ChatToolCallState): ReactNode {
    let icon: ReactElement;
    switch (state) {
        case 'output-available':
            return Icon.check({className: 'xh-chat-tool-call__status-icon', title: 'Done'});
        case 'output-error':
            icon = Icon.warningCircle();
            break;
        case 'output-denied':
            icon = Icon.slashedCircle();
            break;
        case 'approval-requested':
            icon = Icon.hand();
            break;
        default:
            icon = Icon.spinnerThird({spin: true});
    }
    return span({
        className: 'xh-chat-tool-call__status-label',
        items: [icon, STATUS_LABELS[state]]
    });
}

function approvalBar(part: ChatToolCallPart, chatModel: ChatModel): ReactNode {
    return div({
        className: 'xh-chat-tool-call__approval',
        items: [
            span({
                className: 'xh-chat-tool-call__approval-text',
                item: 'Allow this tool to run?'
            }),
            button({
                text: 'Deny',
                outlined: true,
                onClick: () => chatModel.denyToolCallAsync(part.id).catchDefault()
            }),
            button({
                text: 'Approve',
                icon: Icon.check(),
                intent: 'primary',
                minimal: false,
                onClick: () => chatModel.approveToolCallAsync(part.id).catchDefault()
            })
        ]
    });
}

function defaultBody(part: ChatToolCallPart): ReactNode {
    const {state, input, inputText, output, errorText} = part,
        inputValue = state === 'input-streaming' || input == null ? inputText : input,
        hasInput = !isEmpty(inputValue);

    return [
        hasInput ? section('Input', jsonView({value: inputValue})) : null,
        state === 'output-available' ? section('Output', jsonView({value: output})) : null,
        state === 'output-error'
            ? section(
                  'Error',
                  div({className: 'xh-chat-tool-call__error', item: errorText || 'Tool failed.'})
              )
            : null,
        state === 'output-denied'
            ? section(
                  'Denied',
                  div({className: 'xh-chat-tool-call__denied', item: errorText || 'Not run.'})
              )
            : null
    ];
}

function section(label: string, content: ReactNode): ReactNode {
    return div({
        key: label,
        className: 'xh-chat-tool-call__section',
        items: [div({className: 'xh-chat-tool-call__section-label', item: label}), content]
    });
}
