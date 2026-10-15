import {compact, isEmpty, isString} from 'lodash';
import type {ReactNode} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {chatMarkdown} from '../../../cmp/markdown';
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
import {chatSpinner} from '../../impl/ChatLiveCues';
import {chatToolApproval} from './impl/ChatToolApproval';
import {getToolCallDisplay} from './impl/groupParts';
import {CHAT_MARKDOWN_COMPONENTS} from './impl/MarkdownComponents';

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
 * its input streams, and if the call waits for approval, fails or is denied. A tool with
 * `display: 'answer'` shows the same way, and with no renderer shows its output itself. A tool
 * with `display: 'hidden'` shows nothing, except while a call waits for the user. A `timeline`
 * call shows here as a row - in a reply, the message view puts it in a `ChatTimeline` instead.
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

        switch (chatHost ? getToolCallDisplay(part, chatHost) : 'card') {
            case 'hidden':
                return null;
            case 'inline':
            case 'answer':
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
                isApproval ? chatToolApproval({part, spec, host: chatHost}) : null,
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

interface InlineToolCallArgs extends ChatToolCallProps {
    host: ChatMessageListHost;
    spec: ChatToolSpec;
    impl: ChatToolCallLocalModel;
}

/**
 * A call with `display: 'inline'` or `'answer'` - the renderer's output, then a quiet caption. An
 * answer tool with no renderer shows its output: text as markdown, anything else as JSON. The caption shows
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
        // An answer tool with no renderer shows its output itself, once it has one.
        hasOutputView =
            !!spec.renderer || (spec.display === 'answer' && state === 'output-available'),
        showsOutput =
            hasOutputView &&
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
            showsOutput
                ? spec.renderer
                    ? toolCallBody({part, spec, context})
                    : answerOutput(part.output)
                : null,
            state === 'approval-requested' ? chatToolApproval({part, spec, host}) : null,
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

function answerOutput(output: unknown): ReactNode {
    return div({
        className: 'xh-chat-tool-call__answer',
        item: isString(output)
            ? chatMarkdown({content: output, components: CHAT_MARKDOWN_COMPONENTS})
            : jsonView({value: output})
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
