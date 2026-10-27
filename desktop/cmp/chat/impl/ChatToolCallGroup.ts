import {compact, uniq} from 'lodash';
import type {ReactNode} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import {pluralize} from '@xh/hoist/utils/js';
import {
    type ChatPartRenderContext,
    type ChatToolCallPart,
    isToolCallFailed,
    isToolCallFinal
} from '../../../../core';
import {chatToolCall} from '../ChatToolCall';
import {classNames} from '../../../../impl/ClassNames';
import {chatErrorBoundary} from '../ChatErrorBoundary';
import {getHostToolSpec} from './groupParts';
import {getToolTitle} from './ToolCallStatus';
import {chatSpinner} from '../../../impl/ChatLiveCues';

interface ChatToolCallGroupProps extends HoistProps {
    /** Two or more consecutive tool calls of one step. */
    parts: ChatToolCallPart[];

    /** Render context of the message that holds the calls. */
    context: ChatPartRenderContext;
}

/**
 * Consecutive tool calls of one step, folded into one quiet row - "Used 3 tools" - that opens to
 * show each call as its own row, indented below it. Open while any call runs, then closed once all
 * are done, until the user opens or closes it.
 * @internal
 */
export const chatToolCallGroup = hoistCmp.factory<ChatToolCallGroupProps>({
    displayName: 'ChatToolCallGroup',
    className: 'xh-chat-tool-call-group',

    render({className, parts, context}) {
        const impl = useLocalModel(ChatToolCallGroupLocalModel),
            isRunning = parts.some(it => !isToolCallFinal(it)),
            isExpanded = impl.expanded ?? isRunning,
            count = parts.length,
            names = uniq(
                parts.map(it => getToolTitle(it, getHostToolSpec(context.host, it.toolName)))
            ),
            title = `${isRunning ? 'Using' : 'Used'} ${pluralize('tool', count, true)}`,
            problems = getProblems(parts);

        return div({
            className: classNames(className, {
                'xh-chat-tool-call-group--expanded': isExpanded,
                'xh-chat-tool-call-group--running': isRunning,
                'xh-chat-tool-call-group--failed': problems.failed > 0
            }),
            items: [
                button({
                    className: 'xh-chat-tool-call-group__header',
                    text: span({
                        className: 'xh-chat-tool-call-group__row',
                        items: [
                            groupGlyph(isRunning, problems),
                            span({className: 'xh-chat-tool-call-group__title', item: title}),
                            span({
                                className: 'xh-chat-tool-call-group__summary',
                                item: names.join(', ')
                            }),
                            span({
                                className: 'xh-chat-tool-call-group__meta',
                                item: formatProblems(problems)
                            }),
                            span({
                                className: 'xh-chat-tool-call-group__chevron',
                                item: isExpanded ? Icon.chevronUp() : Icon.chevronDown()
                            })
                        ]
                    }),
                    'aria-expanded': isExpanded,
                    'aria-label': compact([title, formatProblems(problems)]).join(', '),
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

interface GroupProblems {
    failed: number;
    denied: number;
}

function getProblems(parts: ChatToolCallPart[]): GroupProblems {
    return {
        failed: parts.filter(isToolCallFailed).length,
        denied: parts.filter(it => it.state === 'output-denied' && !it.cancelled).length
    };
}

function formatProblems({failed, denied}: GroupProblems): string {
    return compact([failed ? `${failed} failed` : null, denied ? `${denied} denied` : null]).join(
        ' · '
    );
}

// A spinner while any call runs, then a check - or a mark when any call failed.
function groupGlyph(isRunning: boolean, {failed}: GroupProblems): ReactNode {
    const kind = isRunning ? 'busy' : failed ? 'error' : 'success';
    return span({
        className: `xh-chat-tool-call__glyph xh-chat-tool-call__glyph--${kind}`,
        item: isRunning
            ? chatSpinner()
            : failed
              ? Icon.error({title: 'Failed'})
              : Icon.check({title: 'All done'})
    });
}
