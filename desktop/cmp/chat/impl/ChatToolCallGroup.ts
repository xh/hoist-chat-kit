import {uniq} from 'lodash';
import type {ReactNode} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import {type ChatPartRenderContext, type ChatToolCallPart, isToolCallFinal} from '../../../../core';
import {chatToolCall} from '../ChatToolCall';
import {classNames} from '../../../../impl/ClassNames';
import {chatErrorBoundary} from './ChatErrorBoundary';
import {getToolTitle} from './ToolCallStatus';
import {chatSpinner} from './ChatLiveCues';

interface ChatToolCallGroupProps extends HoistProps {
    /** Two or more consecutive tool calls of one step. */
    parts: ChatToolCallPart[];

    /** Render context of the message that holds the calls. */
    context: ChatPartRenderContext;
}

/**
 * Consecutive tool calls of one step, folded into one quiet row - "Used 3 tools" - that opens to
 * show each call as a compact row. Open while any call runs, then closed once all are done, until
 * the user opens or closes it.
 * @internal
 */
export const chatToolCallGroup = hoistCmp.factory<ChatToolCallGroupProps>({
    displayName: 'ChatToolCallGroup',
    className: 'xh-chat-tool-call-group',

    render({className, parts, context}) {
        const impl = useLocalModel(ChatToolCallGroupLocalModel),
            {chatModel} = context,
            isRunning = parts.some(it => !isToolCallFinal(it)),
            isExpanded = impl.expanded ?? isRunning,
            count = parts.length,
            names = uniq(parts.map(it => getToolTitle(it, chatModel.getToolSpec(it.toolName))));

        return div({
            className: classNames(className, {
                'xh-chat-tool-call-group--expanded': isExpanded,
                'xh-chat-tool-call-group--running': isRunning
            }),
            items: [
                button({
                    className: 'xh-chat-tool-call-group__header',
                    icon: Icon.wrench(),
                    text: span({
                        className: 'xh-chat-tool-call-group__heading',
                        items: [
                            span({
                                className: 'xh-chat-tool-call-group__title',
                                item: `${isRunning ? 'Using' : 'Used'} ${pluralize('tool', count, true)}`
                            }),
                            span({
                                className: 'xh-chat-tool-call-group__summary',
                                item: names.join(', ')
                            })
                        ]
                    }),
                    rightIcon: span({
                        className: 'xh-chat-tool-call-group__status',
                        items: [
                            groupStatus(parts, isRunning),
                            isExpanded ? Icon.chevronUp() : Icon.chevronDown()
                        ]
                    }),
                    'aria-expanded': isExpanded,
                    onClick: () => impl.setExpanded(!isExpanded)
                }),
                isExpanded
                    ? div({
                          className: 'xh-chat-tool-call-group__items',
                          items: parts.map(part =>
                              chatErrorBoundary({
                                  key: part.id,
                                  resetKey: part.state,
                                  item: chatToolCall({
                                      className: 'xh-chat-tool-call--grouped',
                                      part,
                                      context
                                  })
                              })
                          )
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
class ChatToolCallGroupLocalModel extends HoistModel {
    override xhImpl = true;

    /** Set once the user opens or closes the group - until then it follows its calls. */
    @observable accessor expanded: boolean = null;

    @action
    setExpanded(expanded: boolean) {
        this.expanded = expanded;
    }
}

// A spinner while any call runs, then a check - or the count of calls that failed or were denied.
function groupStatus(parts: ChatToolCallPart[], isRunning: boolean): ReactNode {
    if (isRunning) return chatSpinner();

    const failed = parts.filter(it => it.state === 'output-error').length,
        denied = parts.filter(it => it.state === 'output-denied').length,
        items: ReactNode[] = [];
    if (failed) {
        items.push(
            span({
                key: 'failed',
                className: 'xh-chat-tool-call-group__problem',
                items: [Icon.warningCircle(), `${failed} failed`]
            })
        );
    }
    if (denied) {
        items.push(
            span({
                key: 'denied',
                className:
                    'xh-chat-tool-call-group__problem xh-chat-tool-call-group__problem--denied',
                items: [Icon.slashedCircle(), `${denied} denied`]
            })
        );
    }
    return items.length
        ? items
        : Icon.check({className: 'xh-chat-tool-call__status-icon', title: 'All done'});
}
