import {compact, isEmpty, isFunction} from 'lodash';
import type {ReactNode} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, bindable, observable} from '@xh/hoist/mobx';
import {createObservableRef} from '@xh/hoist/utils/react';
import {
    type ChatMessageListHost,
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
    getErrorLine,
    getInlineStatus,
    getToolCallStatusKind,
    getToolCallStatusLabel,
    getToolTitle,
    type InlineCallStatus,
    statusGlyph
} from './impl/ToolCallStatus';
import {chatSpinner} from './impl/ChatLiveCues';

/** Props for {@link ChatToolCall}. */
export interface ChatToolCallProps extends HoistProps {
    /** The tool call to show. */
    part: ChatToolCallPart;

    /**
     * Render context of the message that holds the call - passed to the tool's renderer. Pass a
     * stable object, such as the one a part renderer receives.
     */
    context: ChatPartRenderContext;

    /**
     * The conversation that holds the call - for the tool's display config, and to approve or deny
     * the call. Default `context.chatModel`.
     */
    host?: ChatMessageListHost;
}

/**
 * A tool call by the model, as a quiet 28px row with an outline. The row leads with the call's
 * status - a spinner while it runs, then a check, or a mark for a failure or a denial - then the
 * tool's title and name, with the first line of any error, and its summary and status words at
 * the right. The row opens to show the call's input and output as JSON, or the tool's own
 * rendering. A call waiting for approval frames itself in the attention color, and shows Allow
 * and Deny, with an optional reason sent with either.
 *
 * Display is configured per tool by its {@link ChatToolSpec}: `displayName`, `icon`, `summary`,
 * `renderer` and `approvalPrompt`. A tool with `display: 'inline'` shows its renderer's output with
 * no row. The output is the call's progress, so a quiet status line shows below it only while
 * its input streams, and if the call waits for approval, fails or is denied.
 *
 * The body mounts only while the row is open, and a custom renderer renders as a component of its
 * own, so it may use hooks. The row re-renders only when its part changes.
 */
export const [ChatToolCall, chatToolCall] = hoistCmp.withFactory<ChatToolCallProps>({
    displayName: 'ChatToolCall',
    className: 'xh-chat-tool-call',

    render({className, part, context, host}, ref) {
        const impl = useLocalModel(ChatToolCallLocalModel),
            chatHost: ChatMessageListHost = host ?? context.chatModel,
            spec = chatHost?.getToolSpec?.(part.toolName);

        if (spec?.display === 'inline') {
            return inlineToolCall({ref, className, part, context, host: chatHost, spec, impl});
        }

        const {state, toolName} = part,
            isApproval = state === 'approval-requested',
            hasRenderer = !!spec?.renderer,
            hasBody = hasRenderer || hasDefaultBody(part),
            isExpanded = hasBody && (impl.expanded ?? (isApproval || hasRenderer)),
            kind = getToolCallStatusKind(part, spec),
            title = getToolTitle(part, spec),
            errorLine = getErrorLine(part),
            meta = compact([spec?.summary?.(part), getToolCallStatusLabel(part, spec)]).join(' · '),
            rowItems = [
                statusGlyph(part, spec),
                spec?.icon ? span({className: 'xh-chat-tool-call__icon', item: spec.icon}) : null,
                span({className: 'xh-chat-tool-call__title', item: title}),
                title !== toolName
                    ? span({className: 'xh-chat-tool-call__name', item: toolName})
                    : null,
                errorLine
                    ? span({
                          className: 'xh-chat-tool-call__detail',
                          title: errorLine,
                          item: errorLine
                      })
                    : null,
                span({className: 'xh-chat-tool-call__meta', item: meta}),
                hasBody
                    ? span({
                          className: 'xh-chat-tool-call__chevron',
                          item: isExpanded ? Icon.chevronUp() : Icon.chevronDown()
                      })
                    : null
            ];

        return div({
            ref,
            className: classNames(
                className,
                `xh-chat-tool-call--${state}`,
                `xh-chat-tool-call--${kind}`,
                {'xh-chat-tool-call--expanded': isExpanded}
            ),
            items: [
                // A row with nothing to open is a plain row, not a button that does nothing.
                hasBody
                    ? button({
                          className: 'xh-chat-tool-call__header',
                          text: span({className: 'xh-chat-tool-call__row', items: rowItems}),
                          'aria-expanded': isExpanded,
                          'aria-label': compact([title, getToolCallStatusLabel(part, spec)]).join(
                              ', '
                          ),
                          onClick: () => impl.setExpanded(!isExpanded)
                      })
                    : div({
                          className: 'xh-chat-tool-call__header xh-chat-tool-call__header--static',
                          item: span({className: 'xh-chat-tool-call__row', items: rowItems})
                      }),
                isApproval ? approvalPanel({part, spec, host: chatHost}) : null,
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

interface ApprovalPanelProps extends HoistProps {
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
 * so that a request never takes the keyboard from someone typing.
 */
const approvalPanel = hoistCmp.factory<ApprovalPanelProps>({
    displayName: 'ChatToolCallApproval',

    render({part, spec, host}) {
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
            className: 'xh-chat-tool-call__approval',
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
                                  onClick: () =>
                                      host.approveToolCallAsync(part.id, reasonOf()).catchDefault()
                              })
                            : null,
                        host?.denyToolCallAsync
                            ? button({
                                  className: 'xh-chat-tool-call__deny',
                                  text: 'Deny',
                                  outlined: true,
                                  minimal: false,
                                  onClick: () =>
                                      host.denyToolCallAsync(part.id, reasonOf()).catchDefault()
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

interface InlineToolCallArgs extends ChatToolCallProps {
    host: ChatMessageListHost;
    spec: ChatToolSpec;
    impl: ChatToolCallLocalModel;
}

/**
 * A call with `display: 'inline'` - the renderer's output, then a quiet caption. The caption shows
 * a status only while the input streams, or if the call fails or is denied - the rendered output
 * is the progress otherwise. A toggle to view the input, and the details of any error, shows on
 * hover or focus.
 *
 * A denied call renders no output, as the user refused what it would show. A call waiting for
 * approval renders none either, unless its spec sets `preview: true`.
 */
function inlineToolCall({ref, className, part, context, host, spec, impl}: InlineToolCallArgs) {
    const {state, errorText} = part,
        // The approval bar asks for approval itself, so the caption need not say so too.
        inlineStatus = getInlineStatus(part, spec),
        status = inlineStatus?.type === 'approval' ? null : inlineStatus,
        inputValue = getInputValue(part),
        hasDetails = !isEmpty(inputValue) || (state === 'output-error' && !!errorText),
        isInputShown = hasDetails && !!impl.expanded,
        showsOutput =
            !!spec.renderer &&
            state !== 'output-denied' &&
            (state !== 'approval-requested' || spec.preview === true || !!spec.approvalPreview);

    return div({
        ref,
        className: classNames(
            className,
            'xh-chat-tool-call--inline',
            `xh-chat-tool-call--${state}`
        ),
        items: [
            showsOutput ? toolCallBody({part, spec, context}) : null,
            state === 'approval-requested' ? approvalPanel({part, spec, host}) : null,
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
            return chatSpinner();
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
