import {compact, isEmpty, isFunction} from 'lodash';
import type {ReactNode} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {
    type ChatPartRenderContext,
    type ChatToolCallPart,
    type ChatToolSpec,
    isToolCallFinal
} from '../../../core';
import '../../../styles/vars.scss';
import './ChatToolCall.scss';
import {classNames} from '../../../impl/ClassNames';
import {jsonView} from './impl/JsonView';
import {
    getInlineStatus,
    getToolTitle,
    type InlineCallStatus,
    statusIndicator
} from './impl/ToolCallStatus';

/** Props for {@link ChatToolCall}. */
export interface ChatToolCallProps extends HoistProps {
    /** The tool call to show. */
    part: ChatToolCallPart;

    /**
     * Render context of the message that holds the call - for the tool's display config, its
     * renderer, and to approve or deny the call. Pass a stable object, such as the one a part
     * renderer receives.
     */
    context: ChatPartRenderContext;
}

/**
 * A tool call by the model, as a collapsible card. The header shows the tool's icon, title, a
 * one-line summary and the call's status. The body shows the call's input and output as JSON, or
 * the tool's own rendering. A call waiting for approval shows Approve and Deny buttons.
 *
 * Display is configured per tool by its {@link ChatToolSpec}: `displayName`, `icon`, `summary`,
 * `renderer` and `approvalPrompt`. A tool with `display: 'inline'` shows its renderer's output with
 * no card. The output is the call's progress, so a quiet status line shows below it only while
 * its input streams, and if the call waits for approval, fails or is denied.
 *
 * The body mounts only while the card is open, and a custom renderer renders as a component of its
 * own, so it may use hooks. The card re-renders only when its part changes.
 */
export const [ChatToolCall, chatToolCall] = hoistCmp.withFactory<ChatToolCallProps>({
    displayName: 'ChatToolCall',
    className: 'xh-chat-tool-call',

    render({className, part, context}, ref) {
        const impl = useLocalModel(ChatToolCallLocalModel),
            {chatModel} = context,
            spec = chatModel.getToolSpec(part.toolName);

        if (spec?.display === 'inline') {
            return inlineToolCall({ref, className, part, context, spec, impl});
        }

        const {state} = part,
            isApproval = state === 'approval-requested',
            hasRenderer = !!spec?.renderer,
            hasBody = hasRenderer || hasDefaultBody(part),
            isExpanded = hasBody && (impl.expanded ?? (isApproval || hasRenderer)),
            summary = spec?.summary?.(part),
            headerItems = [
                span({
                    className: 'xh-chat-tool-call__heading',
                    items: [
                        span({
                            className: 'xh-chat-tool-call__title',
                            item: getToolTitle(part, spec)
                        }),
                        summary
                            ? span({className: 'xh-chat-tool-call__summary', item: summary})
                            : null
                    ]
                }),
                span({
                    className: 'xh-chat-tool-call__status',
                    items: [
                        statusIndicator(part, spec),
                        hasBody ? (isExpanded ? Icon.chevronUp() : Icon.chevronDown()) : null
                    ]
                })
            ],
            icon = spec?.icon ?? Icon.wrench();

        return div({
            ref,
            className: classNames(className, `xh-chat-tool-call--${state}`, {
                'xh-chat-tool-call--expanded': isExpanded
            }),
            items: [
                // A card with nothing to open has a plain header, not a button that does nothing.
                hasBody
                    ? button({
                          className: 'xh-chat-tool-call__header',
                          icon,
                          text: headerItems[0],
                          rightIcon: headerItems[1],
                          'aria-expanded': isExpanded,
                          onClick: () => impl.setExpanded(!isExpanded)
                      })
                    : div({
                          className: 'xh-chat-tool-call__header xh-chat-tool-call__header--static',
                          items: [icon, ...headerItems]
                      }),
                isApproval ? approvalBar(part, spec, context) : null,
                isExpanded
                    ? div({
                          className: 'xh-chat-tool-call__body',
                          item: hasRenderer
                              ? toolCallBody({part, spec, context})
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

interface ToolCallBodyProps extends HoistProps {
    part: ChatToolCallPart;
    spec: ChatToolSpec;
    context: ChatPartRenderContext;
}

// The tool's renderer, as a component of its own: memoized on the part, and the owner of any
// hooks the renderer calls. Takes any model in context, as `useLocalModel()` needs a model spec.
const toolCallBody = hoistCmp.factory<ToolCallBodyProps>({
    displayName: 'ChatToolCallBody',
    model: uses('*', {optional: true}),

    render({part, spec, context}) {
        return spec.renderer(part, context) ?? null;
    }
});

function approvalBar(
    part: ChatToolCallPart,
    spec: ChatToolSpec,
    {chatModel}: ChatPartRenderContext
): ReactNode {
    const {approvalPrompt} = spec ?? {},
        prompt = isFunction(approvalPrompt)
            ? approvalPrompt(part.input ?? {})
            : (approvalPrompt ?? 'Allow this action to run?');

    return div({
        className: 'xh-chat-tool-call__approval',
        items: [
            div({className: 'xh-chat-tool-call__approval-text', item: prompt}),
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

interface InlineToolCallArgs extends ChatToolCallProps {
    spec: ChatToolSpec;
    impl: ChatToolCallLocalModel;
}

/**
 * A call with `display: 'inline'` - the renderer's output, then a quiet caption. The caption shows
 * a status only while the input streams, or if the call fails or is denied - the rendered output
 * is the progress otherwise. A toggle to view the input, and the details of any error, shows on
 * hover or focus.
 */
function inlineToolCall({ref, className, part, context, spec, impl}: InlineToolCallArgs) {
    const {state, errorText} = part,
        // The approval bar asks for approval itself, so the caption need not say so too.
        inlineStatus = getInlineStatus(part, spec),
        status = inlineStatus?.type === 'approval' ? null : inlineStatus,
        inputValue = getInputValue(part),
        hasDetails = !isEmpty(inputValue) || (state === 'output-error' && !!errorText),
        isInputShown = hasDetails && !!impl.expanded;

    return div({
        ref,
        className: classNames(
            className,
            'xh-chat-tool-call--inline',
            `xh-chat-tool-call--${state}`
        ),
        items: [
            spec.renderer ? toolCallBody({part, spec, context}) : null,
            state === 'approval-requested' ? approvalBar(part, spec, context) : null,
            div({
                className: classNames('xh-chat-tool-call__caption', {
                    'xh-chat-tool-call__caption--quiet': !status && !isInputShown
                }),
                items: [
                    status
                        ? span({
                              className: `xh-chat-tool-call__caption-status xh-chat-tool-call__caption-status--${status.type}`,
                              items: [inlineStatusIcon(status.type), status.label]
                          })
                        : null,
                    hasDetails
                        ? button({
                              className: 'xh-chat-tool-call__input-toggle',
                              text: isInputShown ? 'Hide input' : 'View input',
                              rightIcon: isInputShown ? Icon.chevronUp() : Icon.chevronDown(),
                              'aria-expanded': isInputShown,
                              onClick: () => impl.setExpanded(!isInputShown)
                          })
                        : null
                ]
            }),
            isInputShown
                ? div({
                      className: 'xh-chat-tool-call__details',
                      items: [
                          state === 'output-error' && errorText
                              ? div({className: 'xh-chat-tool-call__error', item: errorText})
                              : null,
                          !isEmpty(inputValue) ? jsonView({value: inputValue}) : null
                      ]
                  })
                : null
        ]
    });
}

function inlineStatusIcon(type: InlineCallStatus['type']): ReactNode {
    switch (type) {
        case 'rendering':
            return Icon.spinnerThird({spin: true});
        case 'approval':
            return Icon.hand();
        case 'error':
            return Icon.warningCircle();
        case 'denied':
            return Icon.slashedCircle();
    }
}

/** The call's input - its raw text while it streams or if unparseable, else the parsed value. */
function getInputValue(part: ChatToolCallPart): unknown {
    const {state, input, inputText} = part;
    return state === 'input-streaming' || input == null ? inputText : input;
}

/** True if the default body has something to show - an input, or a final result. */
function hasDefaultBody(part: ChatToolCallPart): boolean {
    return !isEmpty(getInputValue(part)) || isToolCallFinal(part);
}

function defaultBody(part: ChatToolCallPart): ReactNode[] {
    const {state, output, errorText} = part,
        inputValue = getInputValue(part);

    return compact([
        !isEmpty(inputValue) ? section('Input', jsonView({value: inputValue})) : null,
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
    ]);
}

function section(label: string, content: ReactNode): ReactNode {
    return div({
        key: label,
        className: 'xh-chat-tool-call__section',
        items: [div({className: 'xh-chat-tool-call__section-label', item: label}), content]
    });
}
